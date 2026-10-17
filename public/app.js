/**
 * NPTEL BIODIVERSITY FOR SUSTAINABILITY
 * High-Velocity Study & Active-Recall Drill Engine
 * Zero AI-slop, Zero Emojis, Zero Em-Dashes.
 */

(function () {
  'use strict';

  // --- STATE CONTRACT ------------------------------------------------------
  const state = {
    bundle: null,
    activeView: 'learn',
    theme: localStorage.getItem('biodiversity_theme') || 'dark',

    // Mode 1: Learn
    learn: {
      selectedWeek: 1,
      selectedLecture: 'Lec 01',
      questions: [],
      currentIndex: 0,
      answered: false,
      selectedOption: null,
      flagged: new Set(),
      briefingCollapsed: false,
    },

    // Mode 2: Official Speedrun
    speedrun: {
      filterWeek: 'all',
      questions: [],
      currentIndex: 0,
      answered: false,
      selectedOption: null,
      correctCount: 0,
      totalAnswered: 0,
      flagged: new Set(),
    },

    // Mode 3: Final Simulator (50 MCQs: 13 Official + 37 Mock)
    exam: {
      isActive: false,
      questions: [],
      currentIndex: 0,
      userAnswers: new Array(50).fill(null),
      flagged: new Set(),
      isInstantDiagnostic: false,
      timeRemainingSeconds: 90 * 60, // 90 minutes
      timerInterval: null,
      submitted: false,
      analytics: null,
    },

    // Mode 4: Spaced Repetition Mistakes
    mistakes: {
      bank: {}, // id -> { questionObj, times_missed, consecutive_correct, last_ts }
      activeList: [],
      currentIndex: 0,
      answered: false,
      selectedOption: null,
    },

    // Mode 5: Textbook & Cheatsheet Reviser
    reviser: {
      activeType: 'blueprint', // 'blueprint' | 'textbook' | 'cheatsheet' | 'pdf'
      activePart: 1,
      activeWeek: 1,
      filterText: '',
    },

    // Split-Screen Drawer
    drawer: {
      isOpen: false,
      activeContext: 'week_1',
      filterText: '',
    },

    // Command Palette
    search: {
      isOpen: false,
      results: [],
      selectedIndex: 0,
    },
  };

  // --- SAFE VIEW TRANSITIONS -----------------------------------------------
  function safeViewTransition(callback) {
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(callback);
    } else {
      callback();
    }
  }

  // --- DOM CACHE & INITIALIZATION ------------------------------------------
  document.addEventListener('DOMContentLoaded', initApp);

  async function initApp() {
    initTheme();
    setupGlobalShortcuts();
    setupHeaderEvents();
    setupSearchPaletteEvents();
    setupDrawerEvents();

    loadMistakesFromStorage();
    updateMistakesBadge();

    try {
      const response = await fetch('/data/study_bundle.json');
      if (!response.ok) throw new Error(`HTTP ${response.status} loading study bundle`);
      state.bundle = await response.json();

      initLearnView();
      initSpeedrunView();
      initReviserView();
      initDrawerContexts();
      initExamSimulator();

      switchView('learn');
    } catch (err) {
      console.error('Failed to load study bundle:', err);
      const main = document.getElementById('app-container');
      if (main) {
        main.innerHTML = `
          <div class="completion-card" style="margin-top: 40px;">
            <div class="completion-eyebrow" style="color: var(--state-wrong);">BUNDLE LOAD FAILED</div>
            <h2 class="completion-title">Error Loading Study Bundle</h2>
            <p class="completion-summary">${escapeHtml(err.message)}</p>
            <p class="completion-summary">Ensure python3 build_web.py has been run and server is running.</p>
          </div>
        `;
      }
    }
  }

  // --- THEME MANAGEMENT ----------------------------------------------------
  function initTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', state.theme);
        localStorage.setItem('biodiversity_theme', state.theme);
      });
    }
  }

  // --- NAVIGATION & VIEW SWITCHING -----------------------------------------
  function setupHeaderEvents() {
    const navTabs = document.querySelectorAll('.nav-tab');
    navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const view = tab.getAttribute('data-view');
        if (view) switchView(view);
      });
    });

    const pdfBtn = document.getElementById('download-pdf-btn');
    if (pdfBtn && state.bundle && !state.bundle.metadata.pdf_available) {
      pdfBtn.style.opacity = '0.5';
      pdfBtn.title = 'PDF generating or not in root';
    }
  }

  function switchView(viewName) {
    if (!['learn', 'speedrun', 'exam', 'mistakes', 'reviser'].includes(viewName)) return;

    safeViewTransition(() => {
      state.activeView = viewName;

      // Update Nav Tabs
      document.querySelectorAll('.nav-tab').forEach((t) => {
        t.classList.toggle('active', t.getAttribute('data-view') === viewName);
      });

      // Update View Panels
      document.querySelectorAll('.view-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `view-${viewName}`);
      });

      // View-specific trigger actions
      if (viewName === 'learn') {
        updateHudLectureText(state.learn.selectedWeek, state.learn.selectedLecture);
        renderCurrentLearnQuestion();
      } else if (viewName === 'speedrun') {
        renderCurrentSpeedrunQuestion();
      } else if (viewName === 'mistakes') {
        initMistakesDrill();
      } else if (viewName === 'reviser') {
        renderReviserContent();
      } else if (viewName === 'exam') {
        if (!state.exam.isActive && !state.exam.submitted) {
          startNewExam();
        }
      }
    });
  }

  function updateHudLectureText(weekNum, lecKey) {
    const chipText = document.getElementById('hud-lecture-text');
    if (chipText) {
      chipText.textContent = `W${String(weekNum).padStart(2, '0')} · ${lecKey}`;
    }
  }

  // =========================================================================
  // VIEW 1: ZERO-TO-HERO LEARN MODE
  // =========================================================================
  function initLearnView() {
    const weekSelect = document.getElementById('learn-week-select');
    const lecSelect = document.getElementById('learn-lecture-select');
    const prevBtn = document.getElementById('learn-prev-lec-btn');
    const nextBtn = document.getElementById('learn-next-lec-btn');
    const nextQBtn = document.getElementById('learn-next-q-btn');
    const flagBtn = document.getElementById('learn-flag-btn');
    const briefingHeader = document.getElementById('learn-briefing-header');
    const completeNextBtn = document.getElementById('learn-complete-next-btn');
    const completeRestartBtn = document.getElementById('learn-complete-restart-btn');

    // Populate Weeks
    if (weekSelect) {
      weekSelect.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const w = i + 1;
        return `<option value="${w}">Week ${String(w).padStart(2, '0')}</option>`;
      }).join('');

      weekSelect.value = state.learn.selectedWeek;
      weekSelect.addEventListener('change', (e) => {
        state.learn.selectedWeek = parseInt(e.target.value, 10);
        updateLectureDropdown(state.learn.selectedWeek);
        loadLearnLecture();
      });
    }

    // Populate Lectures for Week 1
    updateLectureDropdown(1, 'Lec 01');

    if (lecSelect) {
      lecSelect.addEventListener('change', (e) => {
        state.learn.selectedLecture = e.target.value;
        loadLearnLecture();
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => navigateLecture(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateLecture(1));
    if (nextQBtn) nextQBtn.addEventListener('click', () => advanceLearnQuestion());
    if (flagBtn) flagBtn.addEventListener('click', () => toggleFlagCurrentQuestion('learn'));

    if (briefingHeader) {
      briefingHeader.addEventListener('click', () => {
        const card = document.getElementById('learn-briefing-card');
        const btn = document.getElementById('learn-briefing-toggle-btn');
        if (!card) return;
        card.classList.toggle('collapsed');
        const isCollapsed = card.classList.contains('collapsed');
        state.learn.briefingCollapsed = isCollapsed;
        if (btn) {
          btn.textContent = isCollapsed ? 'EXPAND' : 'COLLAPSE';
          btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        }
      });
    }

    if (completeNextBtn) completeNextBtn.addEventListener('click', () => navigateLecture(1));
    if (completeRestartBtn) completeRestartBtn.addEventListener('click', () => loadLearnLecture());

    loadLearnLecture();
  }

  function updateLectureDropdown(weekNum, preferredLec) {
    const lecSelect = document.getElementById('learn-lecture-select');
    if (!lecSelect) return;

    const startLec = (weekNum - 1) * 5 + 1;
    lecSelect.innerHTML = Array.from({ length: 5 }, (_, i) => {
      const num = startLec + i;
      const key = `Lec ${String(num).padStart(2, '0')}`;
      return `<option value="${key}">${key}</option>`;
    }).join('');

    const defaultLec = `Lec ${String(startLec).padStart(2, '0')}`;
    const candidate = preferredLec || state.learn.selectedLecture || defaultLec;
    const candidateNum = parseInt(String(candidate).replace(/\D/g, ''), 10);
    const isValid = candidateNum >= startLec && candidateNum < startLec + 5;
    const finalLec = isValid ? candidate : defaultLec;

    state.learn.selectedLecture = finalLec;
    lecSelect.value = finalLec;
  }

  function navigateLecture(direction) {
    const m = state.learn.selectedLecture.match(/\d+/);
    if (!m) return;
    let currentNum = parseInt(m[0], 10);
    let targetNum = currentNum + direction;
    if (targetNum < 1) targetNum = 1;
    if (targetNum > 60) targetNum = 60;

    const targetWeek = Math.floor((targetNum - 1) / 5) + 1;
    const targetLecKey = `Lec ${String(targetNum).padStart(2, '0')}`;

    state.learn.selectedWeek = targetWeek;
    state.learn.selectedLecture = targetLecKey;

    const weekSelect = document.getElementById('learn-week-select');
    const lecSelect = document.getElementById('learn-lecture-select');
    if (weekSelect) weekSelect.value = targetWeek;
    updateLectureDropdown(targetWeek, targetLecKey);
    state.learn.selectedLecture = targetLecKey;
    if (lecSelect) lecSelect.value = targetLecKey;

    loadLearnLecture();
  }

  function loadLearnLecture() {
    if (!state.bundle) return;

    updateHudLectureText(state.learn.selectedWeek, state.learn.selectedLecture);

    // 1. Briefing Card
    const briefingText =
      state.bundle.lecture_briefings[state.learn.selectedLecture] ||
      'No specific 4-sentence briefing available for this lecture.';
    const briefingBody = document.getElementById('learn-briefing-body');
    const briefingTag = document.getElementById('learn-briefing-lec-tag');
    if (briefingBody) briefingBody.textContent = briefingText;
    if (briefingTag) briefingTag.textContent = state.learn.selectedLecture;

    // 2. Filter Questions for this lecture
    const targetLecNum = parseInt(state.learn.selectedLecture.replace(/\D/g, ''), 10);
    state.learn.questions = state.bundle.questions.filter((q) => {
      const qNum = parseInt(String(q.lecture || '').replace(/\D/g, ''), 10);
      return qNum === targetLecNum;
    });

    state.learn.currentIndex = 0;
    state.learn.answered = false;
    state.learn.selectedOption = null;

    const compCard = document.getElementById('learn-completion-card');
    const mcqCard = document.getElementById('learn-mcq-card');
    if (compCard) compCard.style.display = 'none';
    if (mcqCard) mcqCard.style.display = 'flex';

    renderCurrentLearnQuestion();
  }

  function renderCurrentLearnQuestion() {
    const q = state.learn.questions[state.learn.currentIndex];
    const total = state.learn.questions.length;

    const counter = document.getElementById('learn-progress-counter');
    if (counter) {
      counter.textContent = total > 0 ? `Q ${String(state.learn.currentIndex + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : '00 / 00';
    }

    if (!q) {
      const mcqCard = document.getElementById('learn-mcq-card');
      const compCard = document.getElementById('learn-completion-card');
      if (mcqCard) mcqCard.style.display = 'none';
      if (compCard) {
        compCard.style.display = 'flex';
        const sum = document.getElementById('learn-complete-summary');
        if (sum) sum.textContent = `All questions for ${state.learn.selectedLecture} completed.`;
      }
      return;
    }

    const lecBadge = document.getElementById('learn-meta-lec');
    const sourceBadge = document.getElementById('learn-meta-source');
    const idBadge = document.getElementById('learn-meta-id');
    const stem = document.getElementById('learn-question-stem');
    const flagBtn = document.getElementById('learn-flag-btn');

    if (lecBadge) lecBadge.textContent = q.lecture || state.learn.selectedLecture;
    if (idBadge) idBadge.textContent = q.id;
    if (stem) stem.textContent = q.question;

    const isOfficial = q.source === 'official_quiz';
    if (sourceBadge) {
      sourceBadge.textContent = isOfficial ? 'OFFICIAL QUIZ (30% POOL)' : 'UNSEEN HIGH-YIELD (70% POOL)';
      sourceBadge.className = isOfficial ? 'badge badge-source amber' : 'badge badge-source';
    }

    if (flagBtn) {
      flagBtn.classList.toggle('active', state.learn.flagged.has(q.id));
    }

    // Reset diagnostic panel
    const diag = document.getElementById('learn-diagnostic-drawer');
    if (diag) diag.style.display = 'none';

    state.learn.answered = false;
    state.learn.selectedOption = null;

    // Render Options
    const optionsStack = document.getElementById('learn-options-stack');
    if (!optionsStack) return;

    optionsStack.innerHTML = q.options
      .map((opt, idx) => {
        const key = idx + 1;
        return `
        <button class="option-row" data-option-idx="${idx}" type="button">
          <span class="option-keycap">[${key}]</span>
          <span class="option-text">${escapeHtml(opt)}</span>
        </button>
      `;
      })
      .join('');

    optionsStack.querySelectorAll('.option-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-option-idx'), 10);
        handleLearnOptionSelect(idx);
      });
    });
  }

  function handleLearnOptionSelect(idx) {
    if (state.learn.answered) return;
    const q = state.learn.questions[state.learn.currentIndex];
    if (!q) return;

    state.learn.answered = true;
    state.learn.selectedOption = idx;

    const isCorrect = idx === q.correct_index;

    // Track Mistake Spaced Repetition
    if (!isCorrect) {
      recordMistake(q);
    }

    // Update Option Rows
    const rows = document.querySelectorAll('#learn-options-stack .option-row');
    rows.forEach((row, optIdx) => {
      row.classList.add('locked');
      if (optIdx === q.correct_index) {
        row.classList.add('correct');
      } else if (optIdx === idx && !isCorrect) {
        row.classList.add('wrong');
      } else {
        row.classList.add('dimmed');
      }
    });

    // Reveal Diagnostic Drawer
    const diag = document.getElementById('learn-diagnostic-drawer');
    const ind = document.getElementById('learn-diag-indicator');
    const code = document.getElementById('learn-diag-code');
    const msg = document.getElementById('learn-diag-msg');
    const lesson = document.getElementById('learn-mini-lesson-text');
    const quote = document.getElementById('learn-transcript-quote');
    const quotePanel = document.getElementById('learn-transcript-panel');

    if (ind && code && msg) {
      ind.className = `status-indicator ${isCorrect ? 'correct' : 'wrong'}`;
      code.textContent = isCorrect ? '[CORRECT]' : '[INCORRECT]';
      msg.textContent = isCorrect ? 'Concept Mastered.' : 'Saved to Mistakes Bank.';
    }

    if (lesson) lesson.textContent = q.mini_lesson || 'Review core slide concepts and distractor logic.';

    if (quote && quotePanel) {
      if (q.transcript_quote) {
        quotePanel.style.display = 'block';
        quote.textContent = `"${q.transcript_quote}"`;
      } else {
        quotePanel.style.display = 'none';
      }
    }

    if (diag) diag.style.display = 'flex';
  }

  function advanceLearnQuestion() {
    if (state.learn.currentIndex < state.learn.questions.length - 1) {
      state.learn.currentIndex++;
      renderCurrentLearnQuestion();
    } else {
      const mcqCard = document.getElementById('learn-mcq-card');
      const compCard = document.getElementById('learn-completion-card');
      if (mcqCard) mcqCard.style.display = 'none';
      if (compCard) {
        compCard.style.display = 'flex';
        const sum = document.getElementById('learn-complete-summary');
        if (sum)
          sum.textContent = `You finished all ${state.learn.questions.length} questions for ${state.learn.selectedLecture}.`;
      }
    }
  }

  // =========================================================================
  // VIEW 2: OFFICIAL QUIZ SPEEDRUN (30% POOL)
  // =========================================================================
  function initSpeedrunView() {
    const weekSelect = document.getElementById('speedrun-week-select');
    const shuffleBtn = document.getElementById('speedrun-shuffle-btn');
    const nextQBtn = document.getElementById('speedrun-next-q-btn');
    const restartBtn = document.getElementById('speedrun-restart-btn');
    const flagBtn = document.getElementById('speedrun-flag-btn');

    if (weekSelect) {
      weekSelect.innerHTML =
        '<option value="all">All 12 Weeks (120 Questions Pool)</option>' +
        Array.from({ length: 12 }, (_, i) => {
          const w = i + 1;
          return `<option value="${w}">Week ${String(w).padStart(2, '0')}</option>`;
        }).join('');

      weekSelect.addEventListener('change', (e) => {
        state.speedrun.filterWeek = e.target.value;
        loadSpeedrunPool();
      });
    }

    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        shuffleArray(state.speedrun.questions);
        state.speedrun.currentIndex = 0;
        state.speedrun.answered = false;
        renderCurrentSpeedrunQuestion();
      });
    }

    if (nextQBtn) nextQBtn.addEventListener('click', () => advanceSpeedrunQuestion());
    if (restartBtn) restartBtn.addEventListener('click', () => loadSpeedrunPool());
    if (flagBtn) flagBtn.addEventListener('click', () => toggleFlagCurrentQuestion('speedrun'));

    loadSpeedrunPool();
  }

  function loadSpeedrunPool() {
    if (!state.bundle) return;
    const allOfficial = state.bundle.questions.filter((q) => q.source === 'official_quiz');
    if (state.speedrun.filterWeek === 'all') {
      state.speedrun.questions = [...allOfficial];
    } else {
      const w = parseInt(state.speedrun.filterWeek, 10);
      state.speedrun.questions = allOfficial.filter((q) => q.week === w);
    }

    state.speedrun.currentIndex = 0;
    state.speedrun.answered = false;
    state.speedrun.selectedOption = null;
    state.speedrun.correctCount = 0;
    state.speedrun.totalAnswered = 0;

    const compCard = document.getElementById('speedrun-completion-card');
    const mcqCard = document.getElementById('speedrun-mcq-card');
    if (compCard) compCard.style.display = 'none';
    if (mcqCard) mcqCard.style.display = 'flex';

    renderCurrentSpeedrunQuestion();
  }

  function renderCurrentSpeedrunQuestion() {
    const q = state.speedrun.questions[state.speedrun.currentIndex];
    const total = state.speedrun.questions.length;

    const counter = document.getElementById('speedrun-progress-counter');
    const acc = document.getElementById('speedrun-accuracy-counter');
    if (counter) {
      counter.textContent = total > 0 ? `Q ${String(state.speedrun.currentIndex + 1).padStart(3, '0')} / ${String(total).padStart(3, '0')}` : '000 / 000';
    }
    if (acc) {
      const pct = state.speedrun.totalAnswered > 0 ? Math.round((state.speedrun.correctCount / state.speedrun.totalAnswered) * 100) : 100;
      acc.textContent = `Acc: ${pct}%`;
    }

    if (!q) {
      const mcqCard = document.getElementById('speedrun-mcq-card');
      const compCard = document.getElementById('speedrun-completion-card');
      if (mcqCard) mcqCard.style.display = 'none';
      if (compCard) {
        compCard.style.display = 'flex';
        const sum = document.getElementById('speedrun-complete-summary');
        if (sum) {
          sum.textContent = `You completed all ${total} questions. Final score: ${state.speedrun.correctCount} / ${state.speedrun.totalAnswered}.`;
        }
      }
      return;
    }

    const lecBadge = document.getElementById('speedrun-meta-lec');
    const idBadge = document.getElementById('speedrun-meta-id');
    const stem = document.getElementById('speedrun-question-stem');
    const flagBtn = document.getElementById('speedrun-flag-btn');

    if (lecBadge) lecBadge.textContent = `WEEK ${String(q.week).padStart(2, '0')}`;
    if (idBadge) idBadge.textContent = q.id;
    if (stem) stem.textContent = q.question;
    if (flagBtn) flagBtn.classList.toggle('active', state.speedrun.flagged.has(q.id));

    const diag = document.getElementById('speedrun-diagnostic-drawer');
    if (diag) diag.style.display = 'none';

    state.speedrun.answered = false;
    state.speedrun.selectedOption = null;

    const stack = document.getElementById('speedrun-options-stack');
    if (!stack) return;

    stack.innerHTML = q.options
      .map((opt, idx) => {
        return `
        <button class="option-row" data-option-idx="${idx}" type="button">
          <span class="option-keycap">[${idx + 1}]</span>
          <span class="option-text">${escapeHtml(opt)}</span>
        </button>
      `;
      })
      .join('');

    stack.querySelectorAll('.option-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-option-idx'), 10);
        handleSpeedrunOptionSelect(idx);
      });
    });
  }

  function handleSpeedrunOptionSelect(idx) {
    if (state.speedrun.answered) return;
    const q = state.speedrun.questions[state.speedrun.currentIndex];
    if (!q) return;

    state.speedrun.answered = true;
    state.speedrun.selectedOption = idx;
    state.speedrun.totalAnswered++;

    const isCorrect = idx === q.correct_index;
    if (isCorrect) state.speedrun.correctCount++;
    else recordMistake(q);

    const rows = document.querySelectorAll('#speedrun-options-stack .option-row');
    rows.forEach((row, optIdx) => {
      row.classList.add('locked');
      if (optIdx === q.correct_index) row.classList.add('correct');
      else if (optIdx === idx && !isCorrect) row.classList.add('wrong');
      else row.classList.add('dimmed');
    });

    const diag = document.getElementById('speedrun-diagnostic-drawer');
    const ind = document.getElementById('speedrun-diag-indicator');
    const code = document.getElementById('speedrun-diag-code');
    const msg = document.getElementById('speedrun-diag-msg');
    const lesson = document.getElementById('speedrun-mini-lesson-text');

    if (ind && code && msg) {
      ind.className = `status-indicator ${isCorrect ? 'correct' : 'wrong'}`;
      code.textContent = isCorrect ? '[CORRECT]' : '[INCORRECT]';
      msg.textContent = isCorrect ? 'Official Question Mastered.' : 'Saved to Mistakes Bank.';
    }

    if (lesson) lesson.textContent = q.mini_lesson || 'Review official assignment question logic.';
    if (diag) diag.style.display = 'flex';
  }

  function advanceSpeedrunQuestion() {
    if (state.speedrun.currentIndex < state.speedrun.questions.length - 1) {
      state.speedrun.currentIndex++;
      renderCurrentSpeedrunQuestion();
    } else {
      const mcqCard = document.getElementById('speedrun-mcq-card');
      const compCard = document.getElementById('speedrun-completion-card');
      if (mcqCard) mcqCard.style.display = 'none';
      if (compCard) {
        compCard.style.display = 'flex';
        const sum = document.getElementById('speedrun-complete-summary');
        if (sum) {
          sum.textContent = `Completed all questions in this set. Score: ${state.speedrun.correctCount} / ${state.speedrun.totalAnswered}.`;
        }
      }
    }
  }

  // =========================================================================
  // VIEW 3: 50-MCQ FINAL EXAM SIMULATOR
  // =========================================================================
  function initExamSimulator() {
    const instantToggle = document.getElementById('exam-instant-toggle');
    const prevBtn = document.getElementById('exam-prev-btn');
    const nextBtn = document.getElementById('exam-next-btn');
    const submitBtn = document.getElementById('exam-submit-btn');
    const restartBtn = document.getElementById('exam-restart-btn');
    const flagBtn = document.getElementById('exam-flag-btn');

    if (instantToggle) {
      instantToggle.addEventListener('change', (e) => {
        state.exam.isInstantDiagnostic = e.target.checked;
        const diag = document.getElementById('exam-diagnostic-drawer');
        if (diag && !state.exam.isInstantDiagnostic) diag.style.display = 'none';
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => navigateExamQuestion(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateExamQuestion(1));
    if (submitBtn) {
      submitBtn.addEventListener('click', () => {
        if (confirm('Are you ready to submit your 50-MCQ Final Exam simulator?')) {
          submitExam();
        }
      });
    }

    if (restartBtn) restartBtn.addEventListener('click', () => startNewExam());
    if (flagBtn) flagBtn.addEventListener('click', () => toggleFlagCurrentQuestion('exam'));
  }

  function startNewExam() {
    if (!state.bundle) return;

    // Blueprint: Exactly 13 questions from official assignments, 37 questions stratified from mocks
    const officialPool = state.bundle.questions.filter((q) => q.source === 'official_quiz');
    const mockPool = state.bundle.questions.filter((q) => q.source !== 'official_quiz');

    shuffleArray(officialPool);
    shuffleArray(mockPool);

    const selected13Official = officialPool.slice(0, 13);
    const selected37Mock = mockPool.slice(0, 37);

    const final50 = [...selected13Official, ...selected37Mock];
    shuffleArray(final50);

    state.exam.questions = final50;
    state.exam.currentIndex = 0;
    state.exam.userAnswers = new Array(50).fill(null);
    state.exam.flagged = new Set();
    state.exam.submitted = false;
    state.exam.isActive = true;
    state.exam.timeRemainingSeconds = 90 * 60;

    clearInterval(state.exam.timerInterval);
    state.exam.timerInterval = setInterval(updateExamTimer, 1000);

    const mcqCard = document.getElementById('exam-mcq-card');
    const analyticsCard = document.getElementById('exam-analytics-card');
    if (mcqCard) mcqCard.style.display = 'flex';
    if (analyticsCard) analyticsCard.style.display = 'none';

    renderExamMatrixGrid();
    renderCurrentExamQuestion();
  }

  function updateExamTimer() {
    if (!state.exam.isActive) return;
    if (state.exam.timeRemainingSeconds <= 0) {
      clearInterval(state.exam.timerInterval);
      alert('Time limit reached. Submitting simulator.');
      submitExam();
      return;
    }

    state.exam.timeRemainingSeconds--;
    const mins = Math.floor(state.exam.timeRemainingSeconds / 60);
    const secs = state.exam.timeRemainingSeconds % 60;
    const display = document.getElementById('exam-timer-display');
    if (display) {
      display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  function renderExamMatrixGrid() {
    const grid = document.getElementById('matrix-grid-50');
    if (!grid) return;

    grid.innerHTML = Array.from({ length: 50 }, (_, i) => {
      const num = i + 1;
      const numStr = String(num).padStart(2, '0');
      const isCurrent = i === state.exam.currentIndex;
      const isAnswered = state.exam.userAnswers[i] !== null;
      const q = state.exam.questions[i];
      const isFlagged = q && state.exam.flagged.has(q.id);

      let classes = ['matrix-btn'];
      if (isCurrent) classes.push('current');
      else if (isAnswered) classes.push('answered');
      if (isFlagged) classes.push('flagged');

      return `<button class="${classes.join(' ')}" data-matrix-idx="${i}" type="button">${numStr}</button>`;
    }).join('');

    grid.querySelectorAll('.matrix-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-matrix-idx'), 10);
        state.exam.currentIndex = idx;
        renderExamMatrixGrid();
        renderCurrentExamQuestion();
      });
    });

    const prog = document.getElementById('matrix-progress-text');
    const answeredCount = state.exam.userAnswers.filter((a) => a !== null).length;
    if (prog) prog.textContent = `${answeredCount} / 50`;
  }

  function renderCurrentExamQuestion() {
    const q = state.exam.questions[state.exam.currentIndex];
    if (!q) return;

    const numBadge = document.getElementById('exam-q-number-badge');
    const sourceBadge = document.getElementById('exam-q-source-badge');
    const lecBadge = document.getElementById('exam-q-lec-badge');
    const stem = document.getElementById('exam-question-stem');
    const flagBtn = document.getElementById('exam-flag-btn');
    const statusSummary = document.getElementById('exam-status-summary');

    if (numBadge) numBadge.textContent = `QUESTION ${String(state.exam.currentIndex + 1).padStart(2, '0')} / 50`;
    if (lecBadge) lecBadge.textContent = `W${String(q.week).padStart(2, '0')} · ${q.lecture || 'Lec'}`;
    if (stem) stem.textContent = q.question;

    const isOfficial = q.source === 'official_quiz';
    if (sourceBadge) {
      sourceBadge.textContent = isOfficial ? 'OFFICIAL REPEAT (30%)' : 'UNSEEN HIGH-YIELD (70%)';
      sourceBadge.className = isOfficial ? 'badge badge-source amber' : 'badge badge-source';
    }

    if (flagBtn) {
      flagBtn.classList.toggle('active', state.exam.flagged.has(q.id));
    }

    const answeredCount = state.exam.userAnswers.filter((a) => a !== null).length;
    if (statusSummary) {
      statusSummary.textContent = `Answered: ${answeredCount} / 50 · Flagged: ${state.exam.flagged.size}`;
    }

    const userSelected = state.exam.userAnswers[state.exam.currentIndex];
    const diag = document.getElementById('exam-diagnostic-drawer');

    if (state.exam.isInstantDiagnostic && userSelected !== null) {
      showExamInstantDiagnostic(q, userSelected);
    } else if (diag) {
      diag.style.display = 'none';
    }

    const stack = document.getElementById('exam-options-stack');
    if (!stack) return;

    stack.innerHTML = q.options
      .map((opt, idx) => {
        let classes = ['option-row'];
        if (userSelected === idx) {
          if (state.exam.isInstantDiagnostic) {
            classes.push(idx === q.correct_index ? 'correct' : 'wrong');
          } else {
            classes.push('correct'); // selected highlight
          }
        }
        return `
        <button class="${classes.join(' ')}" data-option-idx="${idx}" type="button">
          <span class="option-keycap">[${idx + 1}]</span>
          <span class="option-text">${escapeHtml(opt)}</span>
        </button>
      `;
      })
      .join('');

    stack.querySelectorAll('.option-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-option-idx'), 10);
        handleExamOptionSelect(idx);
      });
    });
  }

  function handleExamOptionSelect(idx) {
    if (state.exam.submitted) return;
    state.exam.userAnswers[state.exam.currentIndex] = idx;

    const q = state.exam.questions[state.exam.currentIndex];
    if (idx !== q.correct_index) {
      recordMistake(q);
    }

    renderExamMatrixGrid();
    renderCurrentExamQuestion();
  }

  function showExamInstantDiagnostic(q, userSelected) {
    const diag = document.getElementById('exam-diagnostic-drawer');
    const ind = document.getElementById('exam-diag-indicator');
    const code = document.getElementById('exam-diag-code');
    const msg = document.getElementById('exam-diag-msg');
    const lesson = document.getElementById('exam-mini-lesson-text');

    const isCorrect = userSelected === q.correct_index;
    if (ind && code && msg) {
      ind.className = `status-indicator ${isCorrect ? 'correct' : 'wrong'}`;
      code.textContent = isCorrect ? '[CORRECT]' : '[INCORRECT]';
      msg.textContent = isCorrect ? 'Option verified.' : `Correct answer was [${q.correct_index + 1}].`;
    }
    if (lesson) lesson.textContent = q.mini_lesson || 'Review core slide concepts.';
    if (diag) diag.style.display = 'flex';
  }

  function navigateExamQuestion(direction) {
    const target = state.exam.currentIndex + direction;
    if (target >= 0 && target < state.exam.questions.length) {
      state.exam.currentIndex = target;
      renderExamMatrixGrid();
      renderCurrentExamQuestion();
    }
  }

  function submitExam() {
    clearInterval(state.exam.timerInterval);
    state.exam.isActive = false;
    state.exam.submitted = true;

    // Calculate Analytics
    let totalCorrect = 0;
    let officialCorrect = 0;
    let officialTotal = 0;
    let mockCorrect = 0;
    let mockTotal = 0;
    const weekStats = {};

    state.exam.questions.forEach((q, i) => {
      const userAns = state.exam.userAnswers[i];
      const isCorrect = userAns === q.correct_index;
      if (isCorrect) totalCorrect++;

      const isOfficial = q.source === 'official_quiz';
      if (isOfficial) {
        officialTotal++;
        if (isCorrect) officialCorrect++;
      } else {
        mockTotal++;
        if (isCorrect) mockCorrect++;
      }

      if (!weekStats[q.week]) weekStats[q.week] = { correct: 0, total: 0 };
      weekStats[q.week].total++;
      if (isCorrect) weekStats[q.week].correct++;
    });

    const scorePct = ((totalCorrect / 50) * 100).toFixed(1);

    const mcqCard = document.getElementById('exam-mcq-card');
    const analyticsCard = document.getElementById('exam-analytics-card');
    if (mcqCard) mcqCard.style.display = 'none';
    if (analyticsCard) analyticsCard.style.display = 'flex';

    const finalScore = document.getElementById('exam-final-score');
    const finalPct = document.getElementById('exam-final-percentage');
    const offScore = document.getElementById('exam-official-score');
    const mockScore = document.getElementById('exam-mock-score');
    const flaggedCount = document.getElementById('exam-flagged-count');
    const weekBreakdown = document.getElementById('exam-week-breakdown');

    if (finalScore) finalScore.textContent = `${totalCorrect} / 50`;
    if (finalPct) finalPct.textContent = `${scorePct}%`;
    if (offScore) {
      const offPct = officialTotal > 0 ? Math.round((officialCorrect / officialTotal) * 100) : 0;
      offScore.textContent = `${officialCorrect} / ${officialTotal} (${offPct}%)`;
    }
    if (mockScore) {
      const mockPct = mockTotal > 0 ? Math.round((mockCorrect / mockTotal) * 100) : 0;
      mockScore.textContent = `${mockCorrect} / ${mockTotal} (${mockPct}%)`;
    }
    if (flaggedCount) flaggedCount.textContent = state.exam.flagged.size;

    if (weekBreakdown) {
      weekBreakdown.innerHTML = Object.keys(weekStats)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .map((w) => {
          const s = weekStats[w];
          const pct = Math.round((s.correct / s.total) * 100);
          return `
          <div class="week-accuracy-row">
            <span>Week ${String(w).padStart(2, '0')}</span>
            <span class="tabular-nums">${s.correct} / ${s.total} (${pct}%)</span>
          </div>
        `;
        })
        .join('');
    }
  }

  // =========================================================================
  // VIEW 4: MISTAKES QUEUE (SPACED REPETITION)
  // =========================================================================
  function loadMistakesFromStorage() {
    try {
      const raw = localStorage.getItem('biodiversity_mistakes_v2');
      if (raw) state.mistakes.bank = JSON.parse(raw);
    } catch (e) {
      state.mistakes.bank = {};
    }
  }

  function saveMistakesToStorage() {
    try {
      localStorage.setItem('biodiversity_mistakes_v2', JSON.stringify(state.mistakes.bank));
    } catch (e) {
      console.error('Failed to save mistakes:', e);
    }
    updateMistakesBadge();
  }

  function updateMistakesBadge() {
    const badge = document.getElementById('hud-mistakes-badge');
    const count = Object.keys(state.mistakes.bank).length;
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  function recordMistake(q) {
    if (!state.mistakes.bank[q.id]) {
      state.mistakes.bank[q.id] = {
        question: q,
        times_missed: 1,
        consecutive_correct: 0,
        last_attempt: Date.now(),
      };
    } else {
      state.mistakes.bank[q.id].times_missed++;
      state.mistakes.bank[q.id].consecutive_correct = 0;
      state.mistakes.bank[q.id].last_attempt = Date.now();
    }
    saveMistakesToStorage();
  }

  function initMistakesDrill() {
    const exportBtn = document.getElementById('mistakes-export-btn');
    const importBtn = document.getElementById('mistakes-import-btn');
    const fileInput = document.getElementById('mistakes-import-file');
    const nextBtn = document.getElementById('mistakes-next-q-btn');

    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = 'true';
      exportBtn.addEventListener('click', exportMistakesJson);
    }

    if (importBtn && !importBtn.dataset.bound && fileInput) {
      importBtn.dataset.bound = 'true';
      importBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', importMistakesJson);
    }

    if (nextBtn && !nextBtn.dataset.bound) {
      nextBtn.dataset.bound = 'true';
      nextBtn.addEventListener('click', advanceMistakesDrill);
    }

    state.mistakes.activeList = Object.values(state.mistakes.bank);
    state.mistakes.currentIndex = 0;

    const countPill = document.getElementById('mistakes-count-pill');
    if (countPill) countPill.textContent = `${state.mistakes.activeList.length} ACTIVE TO RETIRE`;

    renderCurrentMistakesQuestion();
  }

  function renderCurrentMistakesQuestion() {
    const mcqCard = document.getElementById('mistakes-mcq-card');
    const emptyCard = document.getElementById('mistakes-empty-card');

    if (state.mistakes.activeList.length === 0) {
      if (mcqCard) mcqCard.style.display = 'none';
      if (emptyCard) emptyCard.style.display = 'flex';
      return;
    }

    if (mcqCard) mcqCard.style.display = 'flex';
    if (emptyCard) emptyCard.style.display = 'none';

    const entry = state.mistakes.activeList[state.mistakes.currentIndex];
    if (!entry) return;

    const q = entry.question;
    const streakBadge = document.getElementById('mistakes-q-streak');
    const missedBadge = document.getElementById('mistakes-q-total-missed');
    const stem = document.getElementById('mistakes-question-stem');

    if (streakBadge) streakBadge.textContent = `CONSECUTIVE CORRECT: ${entry.consecutive_correct} / 2`;
    if (missedBadge) missedBadge.textContent = `MISSED: ${entry.times_missed} TIME${entry.times_missed === 1 ? '' : 'S'}`;
    if (stem) stem.textContent = q.question;

    const diag = document.getElementById('mistakes-diagnostic-drawer');
    if (diag) diag.style.display = 'none';

    state.mistakes.answered = false;
    state.mistakes.selectedOption = null;

    const stack = document.getElementById('mistakes-options-stack');
    if (!stack) return;

    stack.innerHTML = q.options
      .map((opt, idx) => {
        return `
        <button class="option-row" data-option-idx="${idx}" type="button">
          <span class="option-keycap">[${idx + 1}]</span>
          <span class="option-text">${escapeHtml(opt)}</span>
        </button>
      `;
      })
      .join('');

    stack.querySelectorAll('.option-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-option-idx'), 10);
        handleMistakesOptionSelect(idx);
      });
    });
  }

  function handleMistakesOptionSelect(idx) {
    if (state.mistakes.answered) return;
    const entry = state.mistakes.activeList[state.mistakes.currentIndex];
    if (!entry) return;

    const q = entry.question;
    state.mistakes.answered = true;
    state.mistakes.selectedOption = idx;

    const isCorrect = idx === q.correct_index;

    if (isCorrect) {
      entry.consecutive_correct++;
      if (entry.consecutive_correct >= 2) {
        // Auto-retire
        delete state.mistakes.bank[q.id];
      }
    } else {
      entry.times_missed++;
      entry.consecutive_correct = 0;
    }

    saveMistakesToStorage();

    const rows = document.querySelectorAll('#mistakes-options-stack .option-row');
    rows.forEach((row, optIdx) => {
      row.classList.add('locked');
      if (optIdx === q.correct_index) row.classList.add('correct');
      else if (optIdx === idx && !isCorrect) row.classList.add('wrong');
      else row.classList.add('dimmed');
    });

    const diag = document.getElementById('mistakes-diagnostic-drawer');
    const ind = document.getElementById('mistakes-diag-indicator');
    const code = document.getElementById('mistakes-diag-code');
    const msg = document.getElementById('mistakes-diag-msg');
    const lesson = document.getElementById('mistakes-mini-lesson-text');

    if (ind && code && msg) {
      ind.className = `status-indicator ${isCorrect ? 'correct' : 'wrong'}`;
      code.textContent = isCorrect ? '[CORRECT]' : '[INCORRECT]';
      if (isCorrect && entry.consecutive_correct >= 2) {
        msg.textContent = 'Retired from active mistakes queue (2 consecutive correct).';
      } else if (isCorrect) {
        msg.textContent = 'Correct. Need 1 more correct answer to retire.';
      } else {
        msg.textContent = 'Streak reset to 0.';
      }
    }

    if (lesson) lesson.textContent = q.mini_lesson || 'Review core slide concepts.';
    if (diag) diag.style.display = 'flex';
  }

  function advanceMistakesDrill() {
    state.mistakes.activeList = Object.values(state.mistakes.bank);
    if (state.mistakes.currentIndex >= state.mistakes.activeList.length) {
      state.mistakes.currentIndex = 0;
    }
    renderCurrentMistakesQuestion();
  }

  function exportMistakesJson() {
    const blob = new Blob([JSON.stringify(state.mistakes.bank, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biodiversity_mistakes_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importMistakesJson(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (typeof imported === 'object' && imported !== null) {
          state.mistakes.bank = { ...state.mistakes.bank, ...imported };
          saveMistakesToStorage();
          initMistakesDrill();
          alert('Mistakes progress imported successfully.');
        }
      } catch (err) {
        alert('Failed to parse mistakes JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // =========================================================================
  // VIEW 5: TEXTBOOK & CHEATSHEET REVISER
  // =========================================================================
  function initReviserView() {
    const navItems = document.querySelectorAll('.reviser-sidebar .sidebar-nav-item');
    const weeksGrid = document.getElementById('reviser-weeks-grid');
    const tableFilter = document.getElementById('reviser-table-filter');

    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        navItems.forEach((n) => n.classList.remove('active'));
        document.querySelectorAll('.week-pill-btn').forEach((p) => p.classList.remove('active'));
        item.classList.add('active');

        const type = item.getAttribute('data-reviser-type');
        state.reviser.activeType = type;
        if (type === 'textbook') {
          state.reviser.activePart = parseInt(item.getAttribute('data-part'), 10) || 1;
        }
        renderReviserContent();
      });
    });

    if (weeksGrid) {
      weeksGrid.innerHTML = Array.from({ length: 12 }, (_, i) => {
        const w = i + 1;
        return `<button class="week-pill-btn" data-week="${w}" type="button">W${String(w).padStart(2, '0')}</button>`;
      }).join('');

      weeksGrid.querySelectorAll('.week-pill-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          navItems.forEach((n) => n.classList.remove('active'));
          weeksGrid.querySelectorAll('.week-pill-btn').forEach((p) => p.classList.remove('active'));
          btn.classList.add('active');

          state.reviser.activeType = 'cheatsheet';
          state.reviser.activeWeek = parseInt(btn.getAttribute('data-week'), 10);
          renderReviserContent();
        });
      });
    }

    if (tableFilter) {
      tableFilter.addEventListener('input', (e) => {
        state.reviser.filterText = e.target.value.toLowerCase();
        filterReviserContent();
      });
    }

    renderReviserContent();
  }

  function renderReviserContent() {
    if (!state.bundle) return;

    const titleEl = document.getElementById('reviser-doc-title');
    const statsEl = document.getElementById('reviser-doc-stats');
    const scrollBody = document.getElementById('reviser-content-body');
    const pdfContainer = document.getElementById('reviser-pdf-container');

    if (state.reviser.activeType === 'pdf') {
      if (scrollBody) scrollBody.style.display = 'none';
      if (pdfContainer) pdfContainer.style.display = 'block';
      if (titleEl) titleEl.textContent = 'Master Study Guide PDF';
      if (statsEl) statsEl.textContent = '2.80 MB Master PDF Viewer';
      return;
    }

    if (scrollBody) scrollBody.style.display = 'block';
    if (pdfContainer) pdfContainer.style.display = 'none';

    let markdown = '';
    let title = '';
    let stats = '';

    if (state.reviser.activeType === 'blueprint') {
      title = 'Exam Blueprint & High-Yield Strategy';
      markdown = state.bundle.exam_pattern || '# Exam Blueprint\nNot available.';
      stats = `${markdown.length.toLocaleString()} characters`;
    } else if (state.reviser.activeType === 'textbook') {
      const part = state.bundle.textbook_parts.find((p) => p.part_number === state.reviser.activePart);
      if (part) {
        title = part.title;
        markdown = part.content;
        stats = `${part.char_count.toLocaleString()} chars · ${part.filename}`;
      }
    } else if (state.reviser.activeType === 'cheatsheet') {
      const sheet = state.bundle.cheatsheets.find((c) => c.week === state.reviser.activeWeek);
      if (sheet) {
        title = sheet.title;
        markdown = sheet.content;
        stats = `Week ${state.reviser.activeWeek} · ${sheet.terms_count} terms extracted`;
      }
    }

    if (titleEl) titleEl.textContent = title;
    if (statsEl) statsEl.textContent = stats;

    if (scrollBody && window.marked) {
      let html = marked.parse(markdown);
      // Auto-badge tested vs unseen tags
      html = decorateMarkdownBadges(html);
      scrollBody.innerHTML = html;
      filterReviserContent();
    }
  }

  function filterReviserContent() {
    const filter = state.reviser.filterText;
    const scrollBody = document.getElementById('reviser-content-body');
    if (!scrollBody || !filter) {
      if (scrollBody) {
        scrollBody.querySelectorAll('tr').forEach((tr) => (tr.style.display = ''));
        scrollBody.querySelectorAll('p, li').forEach((el) => (el.style.display = ''));
      }
      return;
    }

    const rows = scrollBody.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(filter) ? '' : 'none';
    });
  }

  function decorateMarkdownBadges(html) {
    return html
      .replace(/\[TESTED\s*-\s*30%\s*REPEAT\s*POOL\]/gi, '<span class="table-badge amber">[TESTED - 30% REPEAT POOL]</span>')
      .replace(/\[UNSEEN\s*HIGH-YIELD\s*-\s*70%\s*FINAL\s*POOL\]/gi, '<span class="table-badge teal">[UNSEEN HIGH-YIELD - 70% FINAL POOL]</span>')
      .replace(/\[UNSEEN\s*70%\s*POOL\]/gi, '<span class="table-badge teal">[UNSEEN 70% POOL]</span>')
      .replace(/\[OFFICIAL\s*30%\s*REPEAT\]/gi, '<span class="table-badge amber">[OFFICIAL 30% REPEAT]</span>');
  }

  // =========================================================================
  // SPLIT-SCREEN REVISER SLIDE-OVER DRAWER
  // =========================================================================
  function setupDrawerEvents() {
    const toggleBtn = document.getElementById('toggle-drawer-btn');
    const closeBtn = document.getElementById('drawer-close-btn');
    const drawer = document.getElementById('slideover-reviser-drawer');
    const filterInput = document.getElementById('drawer-table-filter');

    if (toggleBtn) toggleBtn.addEventListener('click', toggleDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        state.drawer.filterText = e.target.value.toLowerCase();
        filterDrawerContent();
      });
    }
  }

  function initDrawerContexts() {
    const select = document.getElementById('drawer-context-select');
    if (!select) return;

    let options = '<option value="blueprint">Exam Blueprint</option>';
    for (let i = 1; i <= 12; i++) {
      options += `<option value="week_${i}">Week ${String(i).padStart(2, '0')} Cheatsheet</option>`;
    }
    for (let p = 1; p <= 4; p++) {
      options += `<option value="part_${p}">Textbook Part ${p}</option>`;
    }
    select.innerHTML = options;

    select.addEventListener('change', (e) => {
      state.drawer.activeContext = e.target.value;
      renderDrawerContent();
    });
  }

  function toggleDrawer() {
    state.drawer.isOpen = !state.drawer.isOpen;
    const drawer = document.getElementById('slideover-reviser-drawer');
    if (drawer) {
      drawer.classList.toggle('open', state.drawer.isOpen);
      drawer.setAttribute('aria-hidden', state.drawer.isOpen ? 'false' : 'true');
    }
    if (state.drawer.isOpen) renderDrawerContent();
  }

  function closeDrawer() {
    state.drawer.isOpen = false;
    const drawer = document.getElementById('slideover-reviser-drawer');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
  }

  function renderDrawerContent() {
    if (!state.bundle) return;
    const body = document.getElementById('drawer-markdown-body');
    const heading = document.getElementById('drawer-heading-text');
    if (!body || !window.marked) return;

    let md = '';
    const ctx = state.drawer.activeContext;

    if (ctx === 'blueprint') {
      if (heading) heading.textContent = 'Exam Blueprint';
      md = state.bundle.exam_pattern || '';
    } else if (ctx.startsWith('week_')) {
      const w = parseInt(ctx.replace('week_', ''), 10);
      const sheet = state.bundle.cheatsheets.find((c) => c.week === w);
      if (heading) heading.textContent = sheet ? sheet.title : `Week ${w} Cheatsheet`;
      md = sheet ? sheet.content : '';
    } else if (ctx.startsWith('part_')) {
      const p = parseInt(ctx.replace('part_', ''), 10);
      const part = state.bundle.textbook_parts.find((t) => t.part_number === p);
      if (heading) heading.textContent = part ? part.title : `Textbook Part ${p}`;
      md = part ? part.content : '';
    }

    body.innerHTML = decorateMarkdownBadges(marked.parse(md));
    filterDrawerContent();
  }

  function filterDrawerContent() {
    const filter = state.drawer.filterText;
    const body = document.getElementById('drawer-markdown-body');
    if (!body) return;

    const rows = body.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      row.style.display = !filter || row.textContent.toLowerCase().includes(filter) ? '' : 'none';
    });
  }

  // =========================================================================
  // COMMAND PALETTE / SEARCH MODAL (CMD+K / CTRL+K)
  // =========================================================================
  function setupSearchPaletteEvents() {
    const cmdKBtn = document.getElementById('cmd-k-btn');
    const backdrop = document.getElementById('search-modal-backdrop');
    const input = document.getElementById('palette-search-input');

    if (cmdKBtn) cmdKBtn.addEventListener('click', openSearchModal);

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeSearchModal();
      });
    }

    if (input) {
      input.addEventListener('input', (e) => handleSearchInput(e.target.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          navigateSearchResults(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          navigateSearchResults(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          selectCurrentSearchResult();
        } else if (e.key === 'Escape') {
          closeSearchModal();
        }
      });
    }
  }

  function openSearchModal() {
    state.search.isOpen = true;
    const backdrop = document.getElementById('search-modal-backdrop');
    const input = document.getElementById('palette-search-input');
    const container = document.getElementById('app-container');

    if (backdrop) backdrop.style.display = 'flex';
    if (container) container.classList.add('modal-active');
    if (input) {
      input.value = '';
      input.focus();
      handleSearchInput('');
    }
  }

  function closeSearchModal() {
    state.search.isOpen = false;
    const backdrop = document.getElementById('search-modal-backdrop');
    const container = document.getElementById('app-container');
    if (backdrop) backdrop.style.display = 'none';
    if (container) container.classList.remove('modal-active');
  }

  function handleSearchInput(query) {
    if (!state.bundle || !state.bundle.search_index) return;
    const cleanQ = query.trim().toLowerCase();

    if (!cleanQ) {
      state.search.results = state.bundle.search_index.slice(0, 15);
    } else {
      state.search.results = state.bundle.search_index
        .filter((item) => item.full_text && item.full_text.toLowerCase().includes(cleanQ))
        .slice(0, 25);
    }

    state.search.selectedIndex = 0;
    renderSearchResults();
  }

  function renderSearchResults() {
    const list = document.getElementById('palette-results-list');
    if (!list) return;

    if (state.search.results.length === 0) {
      list.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--ink-muted); font-size: 13px;">
          No matching concepts or questions found.
        </div>
      `;
      return;
    }

    list.innerHTML = state.search.results
      .map((item, idx) => {
        const isSelected = idx === state.search.selectedIndex;
        const typeClass = item.category === 'term' ? 'term' : item.category === 'official' ? 'official' : '';
        return `
        <div class="palette-item ${isSelected ? 'selected' : ''}" data-result-idx="${idx}">
          <div class="palette-item-top">
            <span class="palette-item-title">${escapeHtml(item.title)}</span>
            <span class="palette-item-type ${typeClass}">${escapeHtml(item.type_label)}</span>
          </div>
          <div class="palette-item-sub">${escapeHtml(item.subtitle)}</div>
          <div class="palette-item-snippet">${escapeHtml(item.snippet)}</div>
        </div>
      `;
      })
      .join('');

    list.querySelectorAll('.palette-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-result-idx'), 10);
        state.search.selectedIndex = idx;
        selectCurrentSearchResult();
      });
    });
  }

  function navigateSearchResults(direction) {
    const total = state.search.results.length;
    if (total === 0) return;
    state.search.selectedIndex = (state.search.selectedIndex + direction + total) % total;
    renderSearchResults();

    const selectedEl = document.querySelector(`.palette-item[data-result-idx="${state.search.selectedIndex}"]`);
    if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
  }

  function selectCurrentSearchResult() {
    const item = state.search.results[state.search.selectedIndex];
    if (!item || !item.target) return;

    closeSearchModal();

    if (item.target.view === 'reviser') {
      switchView('reviser');
      state.reviser.activeType = item.target.reader_type;
      state.reviser.activeWeek = item.target.week;
      state.reviser.filterText = item.target.term || '';
      renderReviserContent();
    } else if (item.target.view === 'learn') {
      switchView('learn');
      state.learn.selectedWeek = item.target.week;
      state.learn.selectedLecture = item.target.lecture;

      const weekSelect = document.getElementById('learn-week-select');
      const lecSelect = document.getElementById('learn-lecture-select');
      if (weekSelect) weekSelect.value = item.target.week;
      updateLectureDropdown(item.target.week, item.target.lecture);
      if (lecSelect) lecSelect.value = item.target.lecture;

      loadLearnLecture();

      if (item.target.question_id) {
        const qIdx = state.learn.questions.findIndex((q) => q.id === item.target.question_id);
        if (qIdx !== -1) {
          state.learn.currentIndex = qIdx;
          renderCurrentLearnQuestion();
        }
      }
    }
  }

  // =========================================================================
  // KEYBOARD-FIRST CONTROLS (1-4, A-D, SPACE, ENTER, M, R, CTRL+K)
  // =========================================================================
  function setupGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      // 1. Search Palette: Cmd+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (state.search.isOpen) closeSearchModal();
        else openSearchModal();
        return;
      }

      // If search palette is open, let palette handle keys
      if (state.search.isOpen) return;

      // 2. Ignore keypress if focus is inside text input or textarea
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }

      const key = e.key;

      // 3. Quick View Switching: Alt + 1-5
      if (e.altKey && ['1', '2', '3', '4', '5'].includes(key)) {
        e.preventDefault();
        const views = ['learn', 'speedrun', 'exam', 'mistakes', 'reviser'];
        switchView(views[parseInt(key, 10) - 1]);
        return;
      }

      // 4. Toggle Reviser Drawer: Key R (when not typing)
      if (key === 'r' || key === 'R') {
        e.preventDefault();
        toggleDrawer();
        return;
      }

      // 5. Flag Question: Key M or F
      if (['m', 'M', 'f', 'F'].includes(key)) {
        e.preventDefault();
        if (state.activeView === 'learn') toggleFlagCurrentQuestion('learn');
        else if (state.activeView === 'speedrun') toggleFlagCurrentQuestion('speedrun');
        else if (state.activeView === 'exam') toggleFlagCurrentQuestion('exam');
        return;
      }

      // 6. Option Selection: 1-4 or A-D
      let optIdx = null;
      if (['1', 'a', 'A'].includes(key)) optIdx = 0;
      else if (['2', 'b', 'B'].includes(key)) optIdx = 1;
      else if (['3', 'c', 'C'].includes(key)) optIdx = 2;
      else if (['4', 'd', 'D'].includes(key)) optIdx = 3;

      if (optIdx !== null) {
        if (state.activeView === 'learn') handleLearnOptionSelect(optIdx);
        else if (state.activeView === 'speedrun') handleSpeedrunOptionSelect(optIdx);
        else if (state.activeView === 'exam') handleExamOptionSelect(optIdx);
        else if (state.activeView === 'mistakes') handleMistakesOptionSelect(optIdx);
        return;
      }

      // 7. Advance / Next Question: Space, Enter, or Right Arrow
      if (['Enter', ' ', 'ArrowRight'].includes(key)) {
        if (state.activeView === 'learn' && state.learn.answered) {
          e.preventDefault();
          advanceLearnQuestion();
        } else if (state.activeView === 'speedrun' && state.speedrun.answered) {
          e.preventDefault();
          advanceSpeedrunQuestion();
        } else if (state.activeView === 'exam' && state.exam.isActive) {
          e.preventDefault();
          navigateExamQuestion(1);
        } else if (state.activeView === 'mistakes' && state.mistakes.answered) {
          e.preventDefault();
          advanceMistakesDrill();
        }
        return;
      }

      // 8. Previous Question (Exam): Left Arrow
      if (key === 'ArrowLeft') {
        if (state.activeView === 'exam' && state.exam.isActive) {
          e.preventDefault();
          navigateExamQuestion(-1);
        }
      }
    });
  }

  function toggleFlagCurrentQuestion(viewName) {
    if (viewName === 'learn') {
      const q = state.learn.questions[state.learn.currentIndex];
      if (!q) return;
      if (state.learn.flagged.has(q.id)) state.learn.flagged.delete(q.id);
      else state.learn.flagged.add(q.id);
      const btn = document.getElementById('learn-flag-btn');
      if (btn) btn.classList.toggle('active', state.learn.flagged.has(q.id));
    } else if (viewName === 'speedrun') {
      const q = state.speedrun.questions[state.speedrun.currentIndex];
      if (!q) return;
      if (state.speedrun.flagged.has(q.id)) state.speedrun.flagged.delete(q.id);
      else state.speedrun.flagged.add(q.id);
      const btn = document.getElementById('speedrun-flag-btn');
      if (btn) btn.classList.toggle('active', state.speedrun.flagged.has(q.id));
    } else if (viewName === 'exam') {
      const q = state.exam.questions[state.exam.currentIndex];
      if (!q) return;
      if (state.exam.flagged.has(q.id)) state.exam.flagged.delete(q.id);
      else state.exam.flagged.add(q.id);
      const btn = document.getElementById('exam-flag-btn');
      if (btn) btn.classList.toggle('active', state.exam.flagged.has(q.id));
      renderExamMatrixGrid();
    }
  }

  // --- UTILITIES -----------------------------------------------------------
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
