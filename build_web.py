#!/usr/bin/env python3
"""
NPTEL Biodiversity for Sustainability
Study Web Data Bundler
Compiles EXAM_PATTERN.md, textbook parts, cheatsheets, and question banks into public/data/study_bundle.json.
Enforces zero emojis, zero em/en dashes, and clean tabular data.
"""

import os
import re
import json
import glob
import shutil
from typing import Dict, List, Any, Optional


def get_project_root() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def clean_typography(text: str) -> str:
    if not text:
        return ""
    emoji_pattern = re.compile(
        "[\U00010000-\U0010ffff]|[\u2600-\u27bf]|[\u2300-\u23ff]|[\u2b50-\u2b55]",
        flags=re.UNICODE,
    )
    text = emoji_pattern.sub("", text)
    text = text.replace("\u2014", " - ")
    text = text.replace("\u2013", "-")
    text = re.sub(r" {2,}", " ", text)
    return text


def load_markdown_file(path: str) -> Optional[str]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return clean_typography(content)
    except Exception as e:
        print(f"! Error loading markdown {path}: {e}")
        return None


def extract_title(markdown_content: str, fallback: str) -> str:
    for line in markdown_content.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return clean_typography(line.lstrip("# ").strip())
    return fallback


def extract_terms_from_cheatsheet(markdown_content: str, week_num: int) -> List[Dict[str, Any]]:
    terms = []
    lines = markdown_content.splitlines()
    in_table = False
    current_lecture = f"Lec {(week_num - 1) * 5 + 1:02d}"

    for line in lines:
        stripped = line.strip()
        lec_match = re.search(r"###\s+(?:Lecture\s+\d+|Lec\s+\d+|Lec\s*(\d+))", stripped, re.IGNORECASE)
        if lec_match:
            num_match = re.search(r"\d+", stripped)
            if num_match:
                current_lecture = f"Lec {int(num_match.group(0)):02d}"

        if stripped.startswith("|") and stripped.endswith("|"):
            parts = [p.strip() for p in stripped.split("|")[1:-1]]
            if len(parts) >= 2:
                p0_lower = parts[0].lower()
                if p0_lower in ["term", "concept", "entity", "species / treaty", "parameter / law"] or "---" in parts[0]:
                    in_table = True
                    continue

                if in_table and len(parts) >= 2 and parts[0]:
                    term_name = clean_typography(parts[0].replace("**", ""))
                    archetype = clean_typography(parts[1]) if len(parts) > 2 else "Core Concept"
                    definition = clean_typography(parts[2]) if len(parts) > 2 else clean_typography(parts[1])
                    tag = clean_typography(parts[3]) if len(parts) > 3 else "High-Yield"

                    if len(term_name) > 1 and not term_name.startswith("---"):
                        terms.append({
                            "week": week_num,
                            "lecture": current_lecture,
                            "term": term_name,
                            "archetype": archetype,
                            "definition": definition,
                            "tag": tag,
                        })
        else:
            in_table = False

    return terms


def normalize_questions_file(file_path: str) -> tuple[List[Dict[str, Any]], Dict[str, str]]:
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    file_base = os.path.basename(file_path)
    is_official = "official" in file_base.lower()

    w_match = re.search(r"week_(\d+)", file_base)
    fallback_week = int(w_match.group(1)) if w_match else 1

    questions_raw = []
    briefings: Dict[str, str] = {}

    if isinstance(data, dict):
        if "questions" in data and isinstance(data["questions"], list):
            questions_raw = data["questions"]
        elif "mock_questions" in data and isinstance(data["mock_questions"], list):
            questions_raw = data["mock_questions"]
        elif "official_questions" in data and isinstance(data["official_questions"], list):
            questions_raw = data["official_questions"]

        if "lecture_briefings" in data and isinstance(data["lecture_briefings"], dict):
            for k, v in data["lecture_briefings"].items():
                briefings[clean_typography(k)] = clean_typography(str(v))
    elif isinstance(data, list):
        questions_raw = data

    normalized_questions = []
    for idx, q in enumerate(questions_raw):
        if not isinstance(q, dict):
            continue

        q_id = q.get("id") or f"W{fallback_week:02d}_{'OFF' if is_official else 'MCQ'}_{idx + 1:02d}"
        q_week = q.get("week", fallback_week)
        try:
            q_week = int(q_week)
        except Exception:
            q_week = fallback_week

        q_lecture = q.get("lecture")
        if not q_lecture:
            lec_offset = (idx % 5) + 1
            calc_lec = (q_week - 1) * 5 + lec_offset
            q_lecture = f"Lec {calc_lec:02d}"
        else:
            m = re.search(r"\d+", str(q_lecture))
            if m:
                q_lecture = f"Lec {int(m.group(0)):02d}"
            else:
                q_lecture = str(q_lecture).strip()

        source_val = "official_quiz" if is_official else "mock_bank"

        stem = clean_typography(q.get("question") or q.get("stem") or "")
        options_raw = q.get("options") or []
        cleaned_options = [clean_typography(str(opt)) for opt in options_raw]

        correct_idx = q.get("correct_index")
        if correct_idx is None:
            ans_letter = q.get("answer") or q.get("correct_answer")
            if isinstance(ans_letter, str) and len(ans_letter.strip()) == 1:
                let = ans_letter.strip().upper()
                if let in ["A", "B", "C", "D"]:
                    correct_idx = ord(let) - ord("A")
                elif let in ["1", "2", "3", "4"]:
                    correct_idx = int(let) - 1
            if correct_idx is None:
                correct_idx = 0
        else:
            try:
                correct_idx = int(correct_idx)
            except Exception:
                correct_idx = 0

        transcript_quote = clean_typography(q.get("transcript_quote") or "")
        mini_lesson = clean_typography(q.get("mini_lesson") or q.get("explanation") or "")

        normalized_questions.append({
            "id": str(q_id),
            "week": q_week,
            "lecture": q_lecture,
            "source": source_val,
            "question": stem,
            "options": cleaned_options,
            "correct_index": correct_idx,
            "transcript_quote": transcript_quote,
            "mini_lesson": mini_lesson,
        })

    return normalized_questions, briefings


def main():
    root_dir = get_project_root()
    public_dir = os.path.join(root_dir, "public")
    data_dir = os.path.join(public_dir, "data")

    os.makedirs(data_dir, exist_ok=True)
    print("==================================================")
    print("NPTEL Biodiversity Study Web Bundler")
    print("==================================================")

    # 1. Read EXAM_PATTERN.md
    exam_pattern_path = os.path.join(root_dir, "EXAM_PATTERN.md")
    exam_pattern_md = load_markdown_file(exam_pattern_path)
    if exam_pattern_md:
        print(f"[OK] Loaded EXAM_PATTERN.md ({len(exam_pattern_md):,} chars)")
    else:
        print("! Warning: EXAM_PATTERN.md not found or empty")
        exam_pattern_md = "# Exam Pattern\nNot available."

    # 2. Read Textbook parts
    textbook_parts = []
    textbook_files = sorted(glob.glob(os.path.join(root_dir, "textbook", "part_*.md")))
    for tf in textbook_files:
        content = load_markdown_file(tf)
        if not content:
            continue
        base_name = os.path.basename(tf)
        part_match = re.search(r"part_(\d+)", base_name)
        part_num = int(part_match.group(1)) if part_match else len(textbook_parts) + 1
        title = extract_title(content, f"Part {part_num}")
        textbook_parts.append({
            "id": f"part_{part_num}",
            "part_number": part_num,
            "filename": base_name,
            "title": title,
            "char_count": len(content),
            "content": content,
        })
    print(f"[OK] Loaded {len(textbook_parts)} Textbook Parts")

    # 3. Read Cheatsheets
    cheatsheets = []
    all_extracted_terms = []
    cheatsheet_files = sorted(
        glob.glob(os.path.join(root_dir, "generated_notes", "week_*_cheatsheet.md")),
        key=lambda p: int(re.search(r"week_(\d+)", p).group(1)) if re.search(r"week_(\d+)", p) else 99,
    )
    for cf in cheatsheet_files:
        content = load_markdown_file(cf)
        if not content:
            continue
        base_name = os.path.basename(cf)
        w_match = re.search(r"week_(\d+)", base_name)
        week_num = int(w_match.group(1)) if w_match else len(cheatsheets) + 1
        title = extract_title(content, f"Week {week_num:02d} Cheatsheet")

        terms = extract_terms_from_cheatsheet(content, week_num)
        all_extracted_terms.extend(terms)

        cheatsheets.append({
            "week": week_num,
            "filename": base_name,
            "title": title,
            "terms_count": len(terms),
            "content": content,
        })
    print(f"[OK] Loaded {len(cheatsheets)} Cheatsheets (Extracted {len(all_extracted_terms)} High-Yield Terms)")

    # 4. Read Mock Bank and Official Quizzes
    all_questions: List[Dict[str, Any]] = []
    all_briefings: Dict[str, str] = {}
    json_files = sorted(glob.glob(os.path.join(root_dir, "mock_bank", "week_*.json")))

    for jf in json_files:
        qs, briefings = normalize_questions_file(jf)
        all_questions.extend(qs)
        for lec_k, b_text in briefings.items():
            m = re.search(r"(\d+)", str(lec_k))
            std_k = f"Lec {int(m.group(1)):02d}" if m else str(lec_k)
            all_briefings[std_k] = b_text

    # Deduplicate questions by ID
    dedup_questions = {}
    for q in all_questions:
        dedup_questions[q["id"]] = q
    all_questions_list = list(dedup_questions.values())

    official_count = sum(1 for q in all_questions_list if q.get("source") == "official_quiz")
    mock_count = sum(1 for q in all_questions_list if q.get("source") != "official_quiz")

    print(f"[OK] Loaded {len(all_questions_list)} Total Questions ({official_count} Official Assignments, {mock_count} Mock Questions)")
    print(f"[OK] Loaded {len(all_briefings)} Lecture Briefings")

    # 5. Build Pre-Computed Search Index
    search_index = []

    # Extracted terms
    for term in all_extracted_terms:
        search_index.append({
            "category": "term",
            "type_label": "High-Yield Term",
            "title": term["term"],
            "subtitle": f"{term['lecture']} (Week {term['week']:02d}) - {term['archetype']}",
            "snippet": term["definition"][:200],
            "full_text": f"{term['term']} {term['definition']} {term['archetype']} {term['tag']}",
            "target": {
                "view": "reviser",
                "reader_type": "cheatsheet",
                "week": term["week"],
                "term": term["term"],
            },
        })

    # Questions
    for q in all_questions_list:
        is_official = q.get("source") == "official_quiz"
        cat = "official" if is_official else "mock"
        lbl = "Official Quiz (30% Pool)" if is_official else "Unseen High-Yield (70%)"
        opts_str = " ".join(q.get("options", []))
        search_index.append({
            "category": cat,
            "type_label": lbl,
            "title": f"[{q['id']}] {q['question'][:90]}...",
            "subtitle": f"{q.get('lecture', 'General')} (Week {q['week']:02d})",
            "snippet": f"Lesson: {q.get('mini_lesson', '')[:140]}",
            "full_text": f"{q['question']} {opts_str} {q.get('mini_lesson', '')} {q.get('transcript_quote', '')}",
            "target": {
                "view": "learn",
                "week": q["week"],
                "lecture": q.get("lecture", "Lec 01"),
                "question_id": q["id"],
            },
        })

    print(f"[OK] Generated Search Index ({len(search_index)} entries)")

    # 6. Copy PDF if it exists
    pdf_source = os.path.join(root_dir, "Biodiversity_Master_Study_Guide.pdf")
    pdf_dest = os.path.join(public_dir, "Biodiversity_Master_Study_Guide.pdf")
    pdf_available = False

    if os.path.exists(pdf_source):
        try:
            shutil.copyfile(pdf_source, pdf_dest)
            pdf_size_mb = os.path.getsize(pdf_dest) / (1024 * 1024)
            print(f"[OK] Copied Master PDF to public/ ({pdf_size_mb:.2f} MB)")
            pdf_available = True
        except Exception as e:
            print(f"! Warning: Failed to copy PDF: {e}")
    else:
        print("! Notice: Biodiversity_Master_Study_Guide.pdf not present in root.")

    # 7. Final Bundle
    study_bundle = {
        "metadata": {
            "title": "NPTEL Biodiversity for Sustainability",
            "instructor": "Dr. Ankur Awadhiya, IFS",
            "total_weeks": 12,
            "total_lectures": 60,
            "total_questions": len(all_questions_list),
            "official_questions_count": official_count,
            "mock_questions_count": mock_count,
            "pdf_available": pdf_available,
            "generated_at": "2026-10-16",
        },
        "exam_pattern": exam_pattern_md,
        "textbook_parts": textbook_parts,
        "cheatsheets": cheatsheets,
        "lecture_briefings": all_briefings,
        "questions": all_questions_list,
        "search_index": search_index,
    }

    bundle_path = os.path.join(data_dir, "study_bundle.json")
    with open(bundle_path, "w", encoding="utf-8") as f:
        json.dump(study_bundle, f, ensure_ascii=False)

    bundle_size_mb = os.path.getsize(bundle_path) / (1024 * 1024)
    print(f"[OK] Wrote study bundle to {bundle_path} ({bundle_size_mb:.2f} MB)")
    print("==================================================")
    print("Bundle generation complete!")


if __name__ == "__main__":
    main()
