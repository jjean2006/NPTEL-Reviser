#!/usr/bin/env python3
"""quiz_cli.py - Interactive terminal crash-course and exam simulator.

Supports 4 modes:
1. --mode rapid-official : Lock in the repeat pool (all official quiz questions across 12 weeks)
2. --mode learn --week X : Zero-to-Hero weekly crash course with lecture briefings
                           (with --lecture Y or interactive lecture jumping/switching)
3. --mode final          : Full 50-MCQ exam simulation (26% official, 74% mock stratified)
4. --mode mistakes       : Spaced repetition drill tracking mistakes_bank.json
"""

import argparse
import glob
import json
import os
import random
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

# Graceful Rich import with ANSI fallback
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    from rich.prompt import Prompt
    from rich.markdown import Markdown
    RICH_AVAILABLE = True
    console = Console()
except ImportError:
    RICH_AVAILABLE = False
    console = None


# ANSI Color Codes for fallback
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"


def print_msg(msg: str = "", style: str = ""):
    """Print message using rich console if available, otherwise plain text."""
    if RICH_AVAILABLE and console:
        console.print(msg, style=style if style else None)
    else:
        print(msg)


def print_box(text: str, title: str = "", border_style: str = "cyan"):
    """Print boxed text using rich Panel or ANSI fallback."""
    if RICH_AVAILABLE and console:
        console.print(Panel(text, title=f"[bold]{title}[/bold]" if title else None, border_style=border_style))
    else:
        lines = text.splitlines() if text else [""]
        box_width = min(80, max([len(line) for line in lines] + [len(title)]) + 4)
        horiz = "─" * (box_width - 2)
        top = f"┌─ {title} {horiz}"[:box_width - 1] + "┐"
        bot = f"└{horiz}┘"
        print(f"{Colors.CYAN}{top}")
        for line in lines:
            print(f"│ {line.ljust(box_width - 4)} │")
        print(f"{bot}{Colors.RESET}")


def load_json_file(filepath: str) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Loads a JSON file which may be dict-wrapped or a flat list.
    
    Returns:
        (questions_list, lecture_briefings_dict)
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print_msg(f"Error reading {filepath}: {e}", style="red")
        return [], {}

    questions = []
    briefings = {}

    if isinstance(data, dict):
        briefings = data.get("lecture_briefings", {})
        raw_questions = data.get("questions", [])
        if isinstance(raw_questions, list):
            questions = raw_questions
    elif isinstance(data, list):
        questions = data

    filename = os.path.basename(filepath)
    m = re.search(r"week_(\d+)_", filename)
    file_week = int(m.group(1)) if m else None
    file_source = "official_quiz" if "official" in filename else "mock_quiz"

    normalized_questions = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        if "week" not in q and file_week is not None:
            q["week"] = file_week
        if "source" not in q:
            q["source"] = file_source
        
        if "correct_index" not in q:
            ans = q.get("correct_answer", q.get("answer"))
            if isinstance(ans, int):
                q["correct_index"] = ans
            elif isinstance(ans, str) and len(ans) == 1 and ans.upper() in "ABCD":
                q["correct_index"] = ord(ans.upper()) - ord("A")
            elif isinstance(ans, str) and ans in q.get("options", []):
                q["correct_index"] = q["options"].index(ans)
            else:
                q["correct_index"] = 0
        
        normalized_questions.append(q)

    return normalized_questions, briefings


def find_files(mock_dir: str, pattern: str) -> List[str]:
    """Finds matching files sorted by week number."""
    matched = glob.glob(os.path.join(mock_dir, pattern))
    def sort_key(path):
        m = re.search(r"week_(\d+)", os.path.basename(path))
        return int(m.group(1)) if m else 999
    return sorted(matched, key=sort_key)


class MistakesBank:
    """Manages the mistakes_bank.json database with spaced repetition tracking."""
    def __init__(self, filepath: str = "mistakes_bank.json"):
        self.filepath = filepath
        self.bank: Dict[str, Dict[str, Any]] = {}
        self.load()

    def load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.bank = json.load(f)
            except Exception:
                self.bank = {}
        else:
            self.bank = {}

    def save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.bank, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print_msg(f"Failed to save mistakes bank: {e}", style="red")

    def record_wrong(self, question: Dict[str, Any]):
        qid = question.get("id") or question.get("question")
        if not qid:
            return
        if qid not in self.bank:
            self.bank[qid] = {
                "question_data": question,
                "times_missed": 1,
                "consecutive_correct": 0
            }
        else:
            self.bank[qid]["question_data"] = question
            self.bank[qid]["times_missed"] = self.bank[qid].get("times_missed", 0) + 1
            self.bank[qid]["consecutive_correct"] = 0
        self.save()

    def record_correct(self, question: Dict[str, Any], in_mistakes_mode: bool = False) -> bool:
        """Returns True if the question was retired from the mistakes bank."""
        qid = question.get("id") or question.get("question")
        if not qid or qid not in self.bank:
            return False

        self.bank[qid]["consecutive_correct"] = self.bank[qid].get("consecutive_correct", 0) + 1
        
        if self.bank[qid]["consecutive_correct"] >= 2:
            del self.bank[qid]
            self.save()
            return True

        self.save()
        return False

    def get_questions(self) -> List[Dict[str, Any]]:
        return [entry["question_data"] for entry in self.bank.values() if "question_data" in entry]


def ask_question(
    q: Dict[str, Any],
    q_num: int,
    total_q: int,
    show_instant_feedback: bool = True,
    mistakes_bank: Optional[MistakesBank] = None,
    in_mistakes_mode: bool = False
) -> Tuple[bool, int]:
    """Prompts the user for an answer (1-4 or a-d) and returns (is_correct, chosen_index)."""
    question_text = q.get("question", "")
    options = q.get("options", [])
    correct_idx = q.get("correct_index", 0)
    qid = q.get("id", f"Q{q_num}")
    lecture = q.get("lecture", "")
    week = q.get("week", "")

    header = f"Question {q_num}/{total_q} [{qid}]"
    if week:
        header += f" (Week {week}" + (f", {lecture}" if lecture else "") + ")"

    if RICH_AVAILABLE and console:
        console.print(f"\n[bold cyan]{'='*80}[/bold cyan]")
        console.print(f"[bold yellow]{header}[/bold yellow]")
        console.print(f"[bold white]{question_text}[/bold white]\n")
        opt_letters = ["A", "B", "C", "D", "E", "F"]
        for i, opt in enumerate(options):
            letter = opt_letters[i] if i < len(opt_letters) else str(i+1)
            console.print(f"  [bold cyan]({letter})[/bold cyan] [white]{opt}[/white]")
    else:
        print(f"\n{'='*80}")
        print(f"{Colors.BOLD}{Colors.YELLOW}{header}{Colors.RESET}")
        print(f"{Colors.BOLD}{question_text}{Colors.RESET}\n")
        opt_letters = ["A", "B", "C", "D", "E", "F"]
        for i, opt in enumerate(options):
            letter = opt_letters[i] if i < len(opt_letters) else str(i+1)
            print(f"  ({letter}) {opt}")

    chosen_idx = -1
    valid_map = {}
    for i in range(len(options)):
        valid_map[str(i + 1)] = i
        if i < 26:
            valid_map[chr(ord("a") + i)] = i
            valid_map[chr(ord("A") + i)] = i

    while True:
        prompt_label = "Your answer (1-4 or A-D, q to quit): "
        try:
            user_input = input(prompt_label).strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting quiz...")
            sys.exit(0)

        if user_input.lower() == 'q':
            print("Session ended by user.")
            sys.exit(0)

        if user_input in valid_map:
            chosen_idx = valid_map[user_input]
            break
        else:
            print_msg("Invalid input. Please enter 1-4 or A-D (or 'q' to quit).", style="yellow")

    is_correct = (chosen_idx == correct_idx)

    retired = False
    if mistakes_bank is not None:
        if is_correct:
            retired = mistakes_bank.record_correct(q, in_mistakes_mode=in_mistakes_mode)
        else:
            mistakes_bank.record_wrong(q)

    if show_instant_feedback:
        display_feedback(q, is_correct, chosen_idx, correct_idx, retired=retired, in_mistakes_mode=in_mistakes_mode)

    return is_correct, chosen_idx


def display_feedback(
    q: Dict[str, Any],
    is_correct: bool,
    chosen_idx: int,
    correct_idx: int,
    retired: bool = False,
    in_mistakes_mode: bool = False
):
    """Displays instant feedback: correctness, correct answer, mini_lesson, transcript_quote."""
    options = q.get("options", [])
    opt_letters = ["A", "B", "C", "D", "E", "F"]
    correct_letter = opt_letters[correct_idx] if correct_idx < len(opt_letters) else str(correct_idx + 1)
    chosen_letter = opt_letters[chosen_idx] if chosen_idx < len(opt_letters) else str(chosen_idx + 1)

    correct_text = options[correct_idx] if correct_idx < len(options) else ""
    mini_lesson = q.get("mini_lesson", "").strip()
    transcript_quote = q.get("transcript_quote", "").strip()

    if is_correct:
        status_msg = f"✓ CORRECT! ({correct_letter}) {correct_text}"
        style_color = "green"
    else:
        status_msg = f"✗ INCORRECT. You chose ({chosen_letter}). Correct is ({correct_letter}) {correct_text}"
        style_color = "red"

    if retired:
        status_msg += "\n★ Mastered 2x in a row! Retired from Mistakes Bank!"

    feedback_body = []
    if mini_lesson:
        feedback_body.append(f"💡 Mini Lesson:\n{mini_lesson}")
    if transcript_quote:
        feedback_body.append(f"📖 Transcript Quote:\n\"{transcript_quote}\"")

    full_feedback = "\n\n".join(feedback_body) if feedback_body else "No extra feedback available."

    if RICH_AVAILABLE and console:
        console.print(f"\n[bold {style_color}]{status_msg}[/bold {style_color}]")
        if full_feedback:
            console.print(Panel(full_feedback, title="[bold]Explanation & Concept Breakdown[/bold]", border_style=style_color))
    else:
        col = Colors.GREEN if is_correct else Colors.RED
        print(f"\n{Colors.BOLD}{col}{status_msg}{Colors.RESET}")
        print_box(full_feedback, title="Explanation & Concept Breakdown", border_style="green" if is_correct else "red")


def run_rapid_official(mock_dir: str, week_filter: Optional[int] = None, shuffle: bool = False):
    """Mode 1: Rapid Official Quiz Pool across all 12 weeks."""
    files = find_files(mock_dir, "*_official.json")
    if not files:
        print_msg(f"No official quiz files found in '{mock_dir}'.", style="red")
        return

    all_questions = []
    for fpath in files:
        qs, _ = load_json_file(fpath)
        all_questions.extend(qs)

    if week_filter is not None:
        all_questions = [q for q in all_questions if q.get("week") == week_filter]
        if not all_questions:
            print_msg(f"No official questions found for Week {week_filter}.", style="red")
            return

    if shuffle:
        random.shuffle(all_questions)

    title_desc = f"Rapid Official Pool ({len(all_questions)} questions"
    if week_filter:
        title_desc += f", Week {week_filter}"
    title_desc += ")"

    print_box(
        f"Goal: Lock in the 25-30% repeat pool from weekly official assignments.\n"
        f"Loaded {len(all_questions)} questions across official quizzes. Instant feedback enabled.",
        title=title_desc,
        border_style="magenta"
    )

    mistakes_bank = MistakesBank()
    score = 0
    total = len(all_questions)

    for i, q in enumerate(all_questions, 1):
        correct, _ = ask_question(q, i, total, show_instant_feedback=True, mistakes_bank=mistakes_bank)
        if correct:
            score += 1

    pct = (score / total) * 100 if total > 0 else 0
    print_box(
        f"Session Complete!\nScore: {score}/{total} ({pct:.1f}%)\n"
        f"Mistakes recorded in mistakes_bank.json for spaced repetition drill.",
        title="Official Pool Summary",
        border_style="green" if pct >= 75 else "yellow"
    )


def match_lecture_identifier(user_val: str, available_lecs: List[str]) -> Optional[str]:
    """Matches user input like '1', 'Lec 01', '01', 'Lec 16', '16' to canonical lecture key."""
    clean = user_val.strip()
    # 1. Exact or case-insensitive match
    for lec in available_lecs:
        if lec.lower() == clean.lower():
            return lec

    # 2. Extract digits
    num_match = re.search(r"\d+", clean)
    if num_match:
        target_num = int(num_match.group(0))
        # Match global lecture number (e.g. Lec 06 -> 6)
        for lec in available_lecs:
            m = re.search(r"\d+", lec)
            if m and int(m.group(0)) == target_num:
                return lec
        # Match relative 1-based index (e.g., lecture 1 through 5 of this week)
        if 1 <= target_num <= len(available_lecs):
            return available_lecs[target_num - 1]

    return None


def run_learn_mode(mock_dir: str, week: int, lecture_arg: Optional[str] = None):
    """Mode 2: Zero-to-Hero Weekly Crash Course with flexible lecture navigation."""
    official_files = find_files(mock_dir, f"week_{week:02d}_official.json")
    mock_files = find_files(mock_dir, f"week_{week:02d}_mock.json")

    if not official_files and not mock_files:
        print_msg(f"No quiz files found for Week {week:02d} in '{mock_dir}'.", style="red")
        return

    official_qs = []
    mock_qs = []
    briefings = {}

    if official_files:
        qs, b = load_json_file(official_files[0])
        official_qs.extend(qs)
        briefings.update(b)

    if mock_files:
        qs, b = load_json_file(mock_files[0])
        mock_qs.extend(qs)
        for k, v in b.items():
            if k not in briefings:
                briefings[k] = v

    # Group lectures in order
    all_lectures = []
    if briefings:
        def lec_sort_key(lec_str):
            nums = re.findall(r"\d+", lec_str)
            return int(nums[0]) if nums else 999
        all_lectures = sorted(briefings.keys(), key=lec_sort_key)
    else:
        found_lecs = set()
        for q in official_qs + mock_qs:
            if q.get("lecture"):
                found_lecs.add(q.get("lecture"))
        def lec_sort_key(lec_str):
            nums = re.findall(r"\d+", lec_str)
            return int(nums[0]) if nums else 999
        all_lectures = sorted(list(found_lecs), key=lec_sort_key)

    if not all_lectures:
        print_msg(f"No lectures found for Week {week:02d}.", style="red")
        return

    # If --lecture was passed on CLI, start at that lecture
    current_lec_index = 0
    if lecture_arg:
        matched = match_lecture_identifier(lecture_arg, all_lectures)
        if matched:
            current_lec_index = all_lectures.index(matched)
            print_msg(f"Starting directly at {matched}...", style="cyan")
        else:
            print_msg(f"Lecture '{lecture_arg}' not recognized in Week {week:02d}. Available: {', '.join(all_lectures)}", style="yellow")

    print_box(
        f"WEEK {week:02d} CRASH COURSE: Zero-to-Hero\n"
        f"Lectures in Week {week:02d}: {', '.join(all_lectures)}\n\n"
        f"Tips:\n"
        f"• Press [Enter] to proceed to the current lecture.\n"
        f"• Type a lecture number or name (e.g. '1', 'Lec 02', 'jump 3') at any time to switch lectures.\n"
        f"• Type 'list' or 'menu' to see all lectures in this week.",
        title=f"Week {week:02d} Crash Course",
        border_style="cyan"
    )

    mistakes_bank = MistakesBank()
    total_score = 0
    total_questions = 0

    while current_lec_index < len(all_lectures):
        lec_key = all_lectures[current_lec_index]
        lec_briefing = briefings.get(lec_key, "No briefing text available for this lecture.")

        lec_official = [q for q in official_qs if q.get("lecture") == lec_key]
        lec_mock = [q for q in mock_qs if q.get("lecture") == lec_key]
        lec_questions = lec_official + lec_mock

        if not lec_questions:
            lec_num_match = re.search(r"\d+", lec_key)
            if lec_num_match:
                target_num = int(lec_num_match.group(0))
                lec_official = [q for q in official_qs if re.search(r"\d+", q.get("lecture", "")) and int(re.search(r"\d+", q.get("lecture", "")).group(0)) == target_num]
                lec_mock = [q for q in mock_qs if re.search(r"\d+", q.get("lecture", "")) and int(re.search(r"\d+", q.get("lecture", "")).group(0)) == target_num]
                lec_questions = lec_official + lec_mock

        # Display lecture briefing in highlighted box
        print_box(
            lec_briefing,
            title=f"Mental Model & Core Terms: {lec_key}",
            border_style="yellow"
        )

        # Prompt loop allowing user to start or switch lectures
        while True:
            prompt_str = (
                f"\nPress [Enter] to start {len(lec_questions)} questions ({len(lec_official)} official + {len(lec_mock)} mock) for {lec_key}\n"
                f"Or switch lecture [1-{len(all_lectures)}, 'list', or 'q' to quit]: "
            )
            try:
                user_act = input(prompt_str).strip()
            except (KeyboardInterrupt, EOFError):
                print("\nExiting quiz...")
                sys.exit(0)

            if user_act.lower() == 'q':
                print("Session ended by user.")
                sys.exit(0)
            elif user_act == "":
                # Proceed with current lecture
                break
            elif user_act.lower() in ("list", "menu"):
                print("\nAvailable lectures in Week", week, ":")
                for idx, l in enumerate(all_lectures, 1):
                    marker = " <-- CURRENT" if l == lec_key else ""
                    print(f"  [{idx}] {l}{marker}")
                continue
            else:
                jump_match = match_lecture_identifier(user_act.replace("jump", "").strip(), all_lectures)
                if jump_match:
                    print_msg(f"-> Switching to {jump_match}...", style="cyan")
                    current_lec_index = all_lectures.index(jump_match)
                    lec_key = jump_match
                    lec_briefing = briefings.get(lec_key, "No briefing text available.")
                    lec_official = [q for q in official_qs if q.get("lecture") == lec_key]
                    lec_mock = [q for q in mock_qs if q.get("lecture") == lec_key]
                    lec_questions = lec_official + lec_mock
                    print_box(
                        lec_briefing,
                        title=f"Mental Model & Core Terms: {lec_key}",
                        border_style="yellow"
                    )
                else:
                    print_msg(f"Unrecognized lecture '{user_act}'. Type 1-{len(all_lectures)} or 'list' to view options.", style="yellow")

        # Run questions
        lec_score = 0
        for i, q in enumerate(lec_questions, 1):
            correct, _ = ask_question(q, i, len(lec_questions), show_instant_feedback=True, mistakes_bank=mistakes_bank)
            if correct:
                lec_score += 1

        total_score += lec_score
        total_questions += len(lec_questions)

        print_msg(f"\n[Completed {lec_key}: {lec_score}/{len(lec_questions)} correct]\n", style="bold green")

        # Option to advance or jump after lecture completion
        if current_lec_index + 1 < len(all_lectures):
            next_lec = all_lectures[current_lec_index + 1]
            try:
                post_act = input(f"Next: {next_lec}. Press [Enter] to continue, or enter a lecture number to switch: ").strip()
            except (KeyboardInterrupt, EOFError):
                print("\nExiting quiz...")
                sys.exit(0)

            if post_act:
                jump_post = match_lecture_identifier(post_act.replace("jump", "").strip(), all_lectures)
                if jump_post:
                    print_msg(f"-> Switching to {jump_post}...", style="cyan")
                    current_lec_index = all_lectures.index(jump_post)
                    continue
            current_lec_index += 1
        else:
            current_lec_index += 1

    overall_pct = (total_score / total_questions) * 100 if total_questions > 0 else 0
    print_box(
        f"Week {week:02d} Completed!\nTotal Score: {total_score}/{total_questions} ({overall_pct:.1f}%)\n"
        f"Any errors have been logged to mistakes_bank.json.",
        title=f"Week {week:02d} Results",
        border_style="green" if overall_pct >= 75 else "yellow"
    )


def run_final_exam(mock_dir: str, instant_feedback: bool = False):
    """Mode 3: Full 50-MCQ Exam Simulation.
    
    13 questions (26%) from *_official.json
    37 questions (74%) stratified evenly across all 12 weeks of *_mock.json (~3 unseen questions per week).
    """
    official_files = find_files(mock_dir, "*_official.json")
    mock_files = find_files(mock_dir, "*_mock.json")

    if not official_files and not mock_files:
        print_msg(f"No quiz files found in '{mock_dir}'.", style="red")
        return

    all_official = []
    for f in official_files:
        qs, _ = load_json_file(f)
        all_official.extend(qs)

    mocks_by_week: Dict[int, List[Dict[str, Any]]] = {}
    for f in mock_files:
        qs, _ = load_json_file(f)
        for q in qs:
            w = q.get("week", 1)
            mocks_by_week.setdefault(w, []).append(q)

    num_official = min(13, len(all_official))
    selected_official = random.sample(all_official, num_official) if len(all_official) >= num_official else list(all_official)

    target_mock = 50 - len(selected_official)
    selected_mock = []
    sorted_weeks = sorted(mocks_by_week.keys())

    if sorted_weeks:
        base_per_week = target_mock // len(sorted_weeks)
        remainder = target_mock % len(sorted_weeks)

        extra_weeks = set(random.sample(sorted_weeks, remainder)) if remainder > 0 else set()

        for w in sorted_weeks:
            avail = mocks_by_week[w]
            need = base_per_week + (1 if w in extra_weeks else 0)
            pulled = random.sample(avail, min(need, len(avail)))
            selected_mock.extend(pulled)

        if len(selected_mock) < target_mock:
            used_ids = set(q.get("id") for q in selected_mock)
            remaining_pool = [q for w in sorted_weeks for q in mocks_by_week[w] if q.get("id") not in used_ids]
            needed = target_mock - len(selected_mock)
            selected_mock.extend(random.sample(remaining_pool, min(needed, len(remaining_pool))))

    for q in selected_official:
        q["_exam_pool"] = "official"
    for q in selected_mock:
        q["_exam_pool"] = "mock"

    exam_questions = selected_official + selected_mock
    random.shuffle(exam_questions)

    print_box(
        f"FULL 50-MCQ EXAM SIMULATION\n"
        f"Official Repeat Pool: {len(selected_official)} questions (26%)\n"
        f"Unseen Mock Pool:     {len(selected_mock)} questions (74%, stratified across 12 weeks)\n"
        f"Total Questions:      {len(exam_questions)}\n"
        f"Mode: {'Instant Feedback' if instant_feedback else 'Real Exam (Scorecard & Review at end)'}",
        title="NPTEL Final Exam Simulator",
        border_style="magenta"
    )

    mistakes_bank = MistakesBank()
    exam_records = []

    for i, q in enumerate(exam_questions, 1):
        is_correct, chosen_idx = ask_question(
            q,
            i,
            len(exam_questions),
            show_instant_feedback=instant_feedback,
            mistakes_bank=mistakes_bank
        )
        exam_records.append((q, is_correct, chosen_idx))

    if not instant_feedback:
        print_msg("\n[Exam Finished! Generating Scorecard...]\n", style="bold green")

    total_q = len(exam_records)
    total_correct = sum(1 for _, ok, _ in exam_records if ok)
    overall_pct = (total_correct / total_q) * 100 if total_q > 0 else 0

    official_records = [rec for rec in exam_records if rec[0].get("_exam_pool") == "official"]
    mock_records = [rec for rec in exam_records if rec[0].get("_exam_pool") == "mock"]

    off_correct = sum(1 for _, ok, _ in official_records if ok)
    off_pct = (off_correct / len(official_records)) * 100 if official_records else 0

    mock_correct = sum(1 for _, ok, _ in mock_records if ok)
    mock_pct = (mock_correct / len(mock_records)) * 100 if mock_records else 0

    weeks_stats: Dict[int, Dict[str, int]] = {}
    for q, ok, _ in exam_records:
        w = q.get("week", 1)
        if w not in weeks_stats:
            weeks_stats[w] = {"total": 0, "correct": 0}
        weeks_stats[w]["total"] += 1
        if ok:
            weeks_stats[w]["correct"] += 1

    if RICH_AVAILABLE and console:
        summary_table = Table(title="Exam Scorecard Summary", show_header=True, header_style="bold magenta")
        summary_table.add_column("Category", style="cyan")
        summary_table.add_column("Score", justify="right")
        summary_table.add_column("Accuracy", justify="right")

        summary_table.add_row("Overall Score", f"{total_correct}/{total_q}", f"{overall_pct:.1f}%")
        summary_table.add_row("Official Repeat Pool (26%)", f"{off_correct}/{len(official_records)}", f"{off_pct:.1f}%")
        summary_table.add_row("Unseen Mock Pool (74%)", f"{mock_correct}/{len(mock_records)}", f"{mock_pct:.1f}%")
        console.print(summary_table)

        week_table = Table(title="Week-by-Week Breakdown (Target Weak Spots)", show_header=True, header_style="bold blue")
        week_table.add_column("Week", justify="center")
        week_table.add_column("Score", justify="right")
        week_table.add_column("Accuracy", justify="right")
        week_table.add_column("Status / Recommendation", style="bold")

        for w in sorted(weeks_stats.keys()):
            st = weeks_stats[w]
            w_pct = (st["correct"] / st["total"]) * 100 if st["total"] > 0 else 0
            if w_pct >= 80:
                rec = "[green]✓ Strong Mastery[/green]"
            elif w_pct >= 60:
                rec = "[yellow]▲ Needs Refreshing[/yellow]"
            else:
                rec = "[red]✗ Needs Immediate Review[/red]"
            week_table.add_row(f"Week {w:02d}", f"{st['correct']}/{st['total']}", f"{w_pct:.1f}%", rec)

        console.print(week_table)
    else:
        print("\n" + "=" * 60)
        print("EXAM SCORECARD SUMMARY")
        print("=" * 60)
        print(f"Overall Score:               {total_correct}/{total_q} ({overall_pct:.1f}%)")
        print(f"Official Repeat Pool (26%):  {off_correct}/{len(official_records)} ({off_pct:.1f}%)")
        print(f"Unseen Mock Pool (74%):      {mock_correct}/{len(mock_records)} ({mock_pct:.1f}%)")
        print("\nWEEK-BY-WEEK BREAKDOWN:")
        print("-" * 60)
        print(f"{'Week':<10} {'Score':<15} {'Accuracy':<15} {'Status'}")
        print("-" * 60)
        for w in sorted(weeks_stats.keys()):
            st = weeks_stats[w]
            w_pct = (st["correct"] / st["total"]) * 100 if st["total"] > 0 else 0
            status = "Strong" if w_pct >= 80 else ("Review" if w_pct >= 60 else "CRITICAL")
            print(f"Week {w:<5} {st['correct']}/{st['total']:<12} {w_pct:.1f}%{'':<9} {status}")
        print("=" * 60)

    wrong_records = [rec for rec in exam_records if not rec[1]]
    if not instant_feedback and wrong_records:
        try:
            choice = input(f"\nYou missed {len(wrong_records)} question(s). Review explanations now? (y/n): ").strip().lower()
            if choice == 'y':
                for i, (q, _, chosen_idx) in enumerate(wrong_records, 1):
                    correct_idx = q.get("correct_index", 0)
                    display_feedback(q, False, chosen_idx, correct_idx)
                    if i < len(wrong_records):
                        input("\nPress [Enter] for next explanation...")
        except (KeyboardInterrupt, EOFError):
            pass


def run_mistakes_drill():
    """Mode 4: Spaced Repetition Drill.
    
    Quizzes exclusively on mistakes_bank.json.
    Retires a question only after answering it right 2 times in a row.
    """
    mistakes_bank = MistakesBank()
    questions = mistakes_bank.get_questions()

    if not questions:
        print_box(
            "Your Mistakes Bank is completely clear!\n"
            "No missed questions currently logged. Great job!",
            title="Spaced Repetition Drill",
            border_style="green"
        )
        return

    print_box(
        f"SPACED REPETITION DRILL\n"
        f"Active questions in mistakes bank: {len(questions)}\n"
        f"Rule: A question is only retired once you get it right 2 times in a row.",
        title="Mistakes Bank Drill",
        border_style="red"
    )

    random.shuffle(questions)
    total = len(questions)
    session_correct = 0

    for i, q in enumerate(questions, 1):
        correct, _ = ask_question(
            q,
            i,
            total,
            show_instant_feedback=True,
            mistakes_bank=mistakes_bank,
            in_mistakes_mode=True
        )
        if correct:
            session_correct += 1

    remaining = len(mistakes_bank.get_questions())
    print_box(
        f"Mistakes Drill Session Complete!\n"
        f"Correct in this pass: {session_correct}/{total}\n"
        f"Remaining in Mistakes Bank: {remaining} question(s)",
        title="Drill Progress",
        border_style="cyan"
    )


def main():
    parser = argparse.ArgumentParser(
        description="NPTEL Interactive Terminal Crash-Course & Exam Simulator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Modes:
  rapid-official   Quiz all official weekly assignment questions (instant feedback)
  learn            Zero-to-Hero weekly course with lecture briefings (--week required)
  final            Full 50-MCQ exam simulation (26% official, 74% mock stratified)
  mistakes         Spaced repetition drill on missed questions (retires after 2 in a row)
        """
    )
    parser.add_argument(
        "--mode",
        choices=["rapid-official", "learn", "final", "mistakes"],
        required=True,
        help="Operating mode for the quiz CLI"
    )
    parser.add_argument(
        "--week",
        type=int,
        help="Specific week number (1-12) for 'learn' mode or filtering 'rapid-official'"
    )
    parser.add_argument(
        "--lecture",
        type=str,
        help="Target lecture to start at or quiz in 'learn' mode (e.g. 1, 'Lec 03', 14)"
    )
    parser.add_argument(
        "--mock-dir",
        default="mock_bank",
        help="Path to directory containing JSON mock and official files (default: 'mock_bank')"
    )
    parser.add_argument(
        "--shuffle",
        action="store_true",
        help="Shuffle questions in rapid-official mode"
    )
    parser.add_argument(
        "--instant",
        action="store_true",
        help="Enable instant feedback in 'final' exam mode instead of deferred feedback"
    )

    args = parser.parse_args()

    if args.mode == "learn":
        if args.week is None:
            parser.error("--mode learn requires --week X (e.g. --week 1)")
        run_learn_mode(args.mock_dir, args.week, lecture_arg=args.lecture)

    elif args.mode == "rapid-official":
        run_rapid_official(args.mock_dir, week_filter=args.week, shuffle=args.shuffle)

    elif args.mode == "final":
        run_final_exam(args.mock_dir, instant_feedback=args.instant)

    elif args.mode == "mistakes":
        run_mistakes_drill()


if __name__ == "__main__":
    main()
