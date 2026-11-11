document.addEventListener("DOMContentLoaded", () => {

    // =====================================================
    // ELEMENT DATA ANAK
    // =====================================================

    const birthDateInput =
        document.getElementById("birth_date");

    const screeningDateInput =
        document.getElementById("screening_date");

    const ageDisplay =
        document.getElementById("ageDisplay");

    const ageBanner =
        document.getElementById("ageBanner");


    // =====================================================
    // ELEMENT PREMATUR
    // =====================================================

    const prematureRadios =
        document.querySelectorAll(
            'input[name="premature"]'
        );

    const prematureWeeksGroup =
        document.getElementById("prematureWeeksGroup");

    const prematureWeeksInput =
        document.getElementById("premature_weeks");

    const prematureInfo =
        document.getElementById("prematureInfo");


    // =====================================================
    // TOMBOL DATA ANAK
    // =====================================================

    const resetChildButton =
        document.getElementById("resetChildButton");

    const resetConfirmModal =
        document.getElementById("resetConfirmModal");

    const cancelResetButton =
        document.getElementById("cancelResetButton");

    const confirmResetButton =
        document.getElementById("confirmResetButton");

    const saveChildButton =
        document.getElementById("saveChildButton");

    const editChildButton =
        document.getElementById("editChildButton");

    const saveConfirmModal =
        document.getElementById("saveConfirmModal");

    const cancelSaveButton =
        document.getElementById("cancelSaveButton");

    const confirmSaveButton =
        document.getElementById("confirmSaveButton");

    const editConfirmModal =
        document.getElementById("editConfirmModal");

    const cancelEditButton =
        document.getElementById("cancelEditButton");

    const confirmEditButton =
        document.getElementById("confirmEditButton");

    const screeningArea =
        document.querySelector(".screening-area");

    // Kunci hanya area pemeriksaan, bukan footer tombol aksi.
    // Dengan begitu tombol "Lihat Hasil" tetap terlihat aktif dan cursornya normal.
    // Kunci hanya kartu domain. Banner usia dan tombol "Lihat Diagram"
    // tetap aktif agar diagram masih dapat dibuka setelah pemeriksaan disimpan.
    const lockableScreeningSections = document.querySelectorAll(
        ".screening-area .domain-card"
    );

    function setScreeningSectionsLocked(locked) {
        lockableScreeningSections.forEach(section => {
            section.classList.toggle("screening-disabled", Boolean(locked));
        });
    }

    let savedChildData = null;
    let isEditingChild = false;
    let hasExistingSavedExam = false;


    // =====================================================
    // 11.3F — PEMERIKSAAN DENVER II: P/F + TUGAS DINAMIS
    // =====================================================
    const domainCards = document.querySelectorAll(".domain-card[data-domain]");
    const taskDetailModal = document.getElementById("taskDetailModal");
    const taskDetailTitle = document.getElementById("taskDetailTitle");
    const taskDetailBody = document.getElementById("taskDetailBody");

    const DOMAIN_STATE = {};
    let finalAge = null;
    const DOMAIN_NAMES = {
        personal_social: "Personal Sosial",
        fine_motor_adaptive: "Adaptif-Motorik Halus",
        language: "Bahasa",
        gross_motor: "Motorik Kasar"
    };

    function freshDomainState() {
        return {
            initialTasks: [],
            additionalTasks: [],
            answers: {},
            direction: null,
            completed: false,
            exhausted: false,
            loadingNext: false
        };
    }
    domainCards.forEach(card => {
        DOMAIN_STATE[card.dataset.domain] = freshDomainState();
    });

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function allTasks(state) {
        return [...state.initialTasks, ...state.additionalTasks];
    }

    function getCounts(state) {
        const values = Object.values(state.answers);
        return {
            pass: values.filter(value => value === "P").length,
            fail: values.filter(value => value === "F").length,
            answered: values.length
        };
    }

    function statusText(state) {
        if (state.completed || state.exhausted) return "Domain Selesai";
        if (Object.keys(state.answers).length > 0) return "Sedang Dinilai";
        return "Belum Dinilai";
    }

    function taskRow(task, index, state, section) {
        const answer = state.answers[task.id] || "";
        const reportable = task.reportable
            ? '<span class="reportable-badge" title="Item reportable">Laporan</span>'
            : "";
        const detail = task.has_detail && task.footnote
            ? `<button type="button" class="task-detail-button" data-task-id="${escapeHtml(task.id)}">Lihat Detail</button>`
            : "";
        return `
            <tr class="task-row ${answer ? "task-answered" : ""}" data-task-id="${escapeHtml(task.id)}">
                <td class="task-number">${index + 1}</td>
                <td>
                    <div class="task-name-cell">
                        <div class="task-labels">
                            <span class="task-name">${escapeHtml(task.name)}</span>
                            ${reportable}
                        </div>
                        ${detail}
                    </div>
                </td>
                <td class="task-result-cell">
                    <button type="button" class="pf-button p-button ${answer === "P" ? "selected" : ""}" data-answer="P" data-task-id="${escapeHtml(task.id)}" aria-pressed="${answer === "P"}">P</button>
                    <button type="button" class="pf-button f-button ${answer === "F" ? "selected" : ""}" data-answer="F" data-task-id="${escapeHtml(task.id)}" aria-pressed="${answer === "F"}">F</button>
                </td>
            </tr>`;
    }

    function taskTable(title, tasks, state, section) {
        if (!tasks.length) return "";
        const rows = tasks.map((task, index) => taskRow(task, index, state, section)).join("");
        return `
            <div class="task-table-wrapper">
                <table class="task-table assessment-table">
                    <thead>
                        <tr class="section-heading"><th>No.</th><th>${title}</th><th>Hasil (P/F)</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    function ageKey(age) {
        if (!age) return "";
        return `${age.years ?? 0}-${age.months ?? 0}-${age.days ?? 0}`;
    }

    function persistDomainState() {
        if (!finalAge) return;
        try {
            const domains = {};
            Object.entries(DOMAIN_STATE).forEach(([domain, state]) => {
                domains[domain] = {
                    initialTasks: state.initialTasks,
                    additionalTasks: state.additionalTasks,
                    answers: state.answers,
                    direction: state.direction,
                    completed: state.completed,
                    exhausted: state.exhausted
                };
            });
            sessionStorage.setItem("denverDomainState", JSON.stringify({
                ageKey: ageKey(finalAge),
                domains
            }));
        } catch (error) {
            console.warn("Progres pemeriksaan belum dapat disimpan di sesi browser.", error);
        }
    }

    function renderDomain(domain) {
        const card = document.querySelector(`.domain-card[data-domain="${domain}"]`);
        if (!card) return;
        const state = DOMAIN_STATE[domain];
        const content = card.querySelector(".domain-content");
        const status = card.querySelector(".domain-status");
        const counts = getCounts(state);
        if (status) {
            status.textContent = statusText(state);
            status.classList.toggle("status-complete", state.completed || state.exhausted);
            status.classList.toggle("status-progress", !state.completed && !state.exhausted && counts.answered > 0);
        }

        if (!state.initialTasks.length) {
            content.innerHTML = '<p class="empty-domain">Tugas pemeriksaan akan ditampilkan berdasarkan usia anak. Simpan data anak untuk menginputkan pemeriksaan.</p>';
            return;
        }

        const initial = taskTable("Tugas Perkembangan Awal", state.initialTasks, state, "initial");
        const additional = state.additionalTasks.length
            ? taskTable(`Tugas Tambahan${state.direction === "LEFT" ? " — ke kiri (lebih mudah)" : state.direction === "RIGHT" ? " — ke kanan (lebih sulit)" : ""}`, state.additionalTasks, state, "additional")
            : "";
        const nextMessage = state.loadingNext
            ? '<p class="task-progress-message">Memuat tugas berikutnya...</p>'
            : state.exhausted
                ? '<p class="task-progress-message">Tidak ada tugas tambahan yang tersedia pada arah pemeriksaan ini.</p>'
                : state.completed
                    ? '<p class="task-progress-message completed-message">Pemeriksaan domain telah selesai</p>'
                    : "";

        content.innerHTML = `
            ${initial}
            ${additional}
            <div class="domain-score-summary">
                <strong>Hasil Domain ${escapeHtml(DOMAIN_NAMES[domain])}</strong>
                <div class="score-counts"><span class="pass-count">Total Pass: ${counts.pass}</span><span class="score-divider">|</span><span class="fail-count">Total Fail: ${counts.fail}</span></div>
                ${nextMessage}
            </div>`;

        content.querySelectorAll(".pf-button").forEach(button => {
            button.addEventListener("click", () => {
                if (state.completed || state.exhausted) return;
                const taskId = button.dataset.taskId;
                const value = button.dataset.answer;
                const isInitialTask = state.initialTasks.some(task => task.id === taskId);

                // Jika jawaban tugas awal diubah setelah tugas tambahan muncul,
                // hapus tindak lanjut agar arah pemeriksaan dihitung ulang dengan benar.
                if (isInitialTask && state.additionalTasks.length > 0) {
                    state.additionalTasks.forEach(task => delete state.answers[task.id]);
                    state.additionalTasks = [];
                    state.direction = null;
                    state.completed = false;
                    state.exhausted = false;
                }

                if (state.answers[taskId] === value) delete state.answers[taskId];
                else state.answers[taskId] = value;

                renderDomain(domain);
                advanceDomainIfNeeded(domain);
            });
        });

        content.querySelectorAll(".task-detail-button").forEach(button => {
            button.addEventListener("click", () => {
                const task = allTasks(state).find(item => item.id === button.dataset.taskId);
                if (task) showTaskDetail(task);
            });
        });

        persistDomainState();
    }

    function showTaskDetail(task) {
        if (!taskDetailModal || !taskDetailBody || !taskDetailTitle) return;
        taskDetailTitle.textContent = task.name;
        taskDetailBody.textContent = task.footnote || "Tidak ada detail tambahan.";
        taskDetailModal.hidden = false;
    }

    function closeTaskDetail() {
        if (taskDetailModal) taskDetailModal.hidden = true;
    }

    async function requestNextTask(domain, direction) {
        const state = DOMAIN_STATE[domain];
        const excludedIds = allTasks(state).map(task => task.id);
        const response = await fetch("/api/denver/next-task", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ age: finalAge, domain, direction, excluded_ids: excludedIds })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Gagal mengambil tugas tambahan.");
        return result.task;
    }

    async function advanceDomainIfNeeded(domain) {
        const state = DOMAIN_STATE[domain];
        if (state.loadingNext || state.completed || state.exhausted || !state.initialTasks.length) return;

        const tasks = allTasks(state);

        // Tentukan arah setelah semua tugas awal dijawab:
        // semua P -> ke kanan; ada minimal satu F -> ke kiri.
        if (!state.direction) {
            const initialAnswered = state.initialTasks.every(task => state.answers[task.id]);
            if (!initialAnswered) return;

            state.direction = state.initialTasks.every(
                task => state.answers[task.id] === "P"
            ) ? "RIGHT" : "LEFT";
        }

        // Tunggu sampai semua tugas yang sedang tampil sudah dijawab.
        if (!tasks.every(task => state.answers[task.id])) return;

        const additionalAnswers = state.additionalTasks.map(
            task => state.answers[task.id]
        );

        if (state.direction === "LEFT") {
            // Ke kiri: 3 PASS berturut-turut. FAIL mengatur ulang hitungan.
            let consecutivePasses = 0;
            for (const answer of additionalAnswers) {
                if (answer === "P") {
                    consecutivePasses += 1;
                    if (consecutivePasses >= 3) break;
                } else {
                    consecutivePasses = 0;
                }
            }

            if (consecutivePasses >= 3) {
                state.completed = true;
                renderDomain(domain);
                return;
            }
        } else if (state.direction === "RIGHT") {
            // Ke kanan: total 3 FAIL, tidak harus berturut-turut.
            const totalAdditionalFails = additionalAnswers.filter(
                answer => answer === "F"
            ).length;

            if (totalAdditionalFails >= 3) {
                state.completed = true;
                renderDomain(domain);
                return;
            }
        }

        // Ambil hanya satu tugas berikutnya, lalu tunggu jawaban P/F.
        state.loadingNext = true;
        renderDomain(domain);

        try {
            const nextTask = await requestNextTask(domain, state.direction);

            if (!nextTask) {
                state.exhausted = true;
            } else {
                state.additionalTasks.push(nextTask);
            }
        } catch (error) {
            console.error(`Gagal memuat tugas tambahan (${domain}):`, error);
            alert("Tugas tambahan gagal dimuat. Periksa koneksi ke server lalu coba lagi.");
        } finally {
            state.loadingNext = false;
            renderDomain(domain);
        }
    }

    function clearInitialTasks() {
        sessionStorage.removeItem("denverDomainState");
        finalAge = null;
        domainCards.forEach(card => {
            const domain = card.dataset.domain;
            DOMAIN_STATE[domain] = freshDomainState();
            const content = card.querySelector(".domain-content");
            if (content) content.innerHTML = '<p class="empty-domain">Tugas pemeriksaan akan ditampilkan berdasarkan usia anak. Simpan data anak untuk menginputkan pemeriksaan.</p>';
            const status = card.querySelector(".domain-status");
            if (status) {
                status.textContent = "Belum Dinilai";
                status.classList.remove("status-complete", "status-progress");
            }
        });
    }

    async function loadInitialTasks(age) {
        if (!age) { clearInitialTasks(); return; }
        finalAge = age;
        const response = await fetch("/api/denver/initial-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ age })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Gagal memuat tugas awal.");

        let savedDomains = null;
        try {
            const saved = JSON.parse(sessionStorage.getItem("denverDomainState") || "null");
            if (saved && saved.ageKey === ageKey(age)) savedDomains = saved.domains;
        } catch (error) {
            console.warn("Progres pemeriksaan tersimpan tidak dapat dibaca.", error);
        }

        // Siapkan seluruh domain terlebih dahulu agar penyimpanan ulang tidak menghapus domain lain.
        domainCards.forEach(card => {
            const domain = card.dataset.domain;
            const initialTasks = result.tasks[domain] || [];
            const saved = savedDomains && savedDomains[domain];
            const sameInitialTasks = saved &&
                Array.isArray(saved.initialTasks) &&
                saved.initialTasks.map(task => task.id).join("|") ===
                initialTasks.map(task => task.id).join("|");

            DOMAIN_STATE[domain] = freshDomainState();
            DOMAIN_STATE[domain].initialTasks = initialTasks;

            if (sameInitialTasks) {
                DOMAIN_STATE[domain].additionalTasks = Array.isArray(saved.additionalTasks) ? saved.additionalTasks : [];
                DOMAIN_STATE[domain].answers = saved.answers && typeof saved.answers === "object" ? saved.answers : {};
                DOMAIN_STATE[domain].direction = saved.direction || null;
                DOMAIN_STATE[domain].completed = Boolean(saved.completed);
                DOMAIN_STATE[domain].exhausted = Boolean(saved.exhausted);
            }
        });

        domainCards.forEach(card => renderDomain(card.dataset.domain));
    }

    // Dropdown setiap domain berfungsi secara independen.
    domainCards.forEach(card => {
        const button = card.querySelector(".collapse-button");
        const content = card.querySelector(".domain-content");
        if (!button || !content) return;
        button.addEventListener("click", () => {
            const expanded = button.getAttribute("aria-expanded") === "true";
            button.setAttribute("aria-expanded", String(!expanded));
            content.hidden = expanded;
            const chevron = button.querySelector(".collapse-chevron");
            if (chevron) chevron.textContent = "⌄";
        });
    });

    if (taskDetailModal) {
        taskDetailModal.addEventListener("click", event => {
            if (event.target.hasAttribute("data-close-detail")) closeTaskDetail();
        });
    }
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeTaskDetail();
    });

    // =====================================================
    // 11.2B — PERHITUNGAN USIA MELALUI BACKEND
    // =====================================================

    async function updateAge() {

        // Jika tanggal belum lengkap
        if (
            !birthDateInput.value ||
            !screeningDateInput.value
        ) {

            ageDisplay.textContent =
                "Akan dihitung otomatis";

            ageBanner.textContent =
                "Data Anak Belum Disimpan";

            sessionStorage.removeItem(
                "denverAge"
            );

            clearInitialTasks();

            return false;

        }


        // Ambil status prematur
        const prematureRadio =
            document.querySelector(
                'input[name="premature"]:checked'
            );


        const premature =
            prematureRadio
                ? prematureRadio.value
                : "no";


        // Ambil minggu prematur
        const prematureWeeks =
            premature === "yes"
                ? prematureWeeksInput.value
                : 0;


        // Jika prematur = Ya
        // tetapi minggu belum diisi
        if (
            premature === "yes" &&
            !prematureWeeksInput.value
        ) {

            ageDisplay.textContent =
                "Masukkan usia prematur dalam minggu.";

            ageBanner.textContent =
                "Usia belum dapat dihitung";

            sessionStorage.removeItem(
                "denverAge"
            );

            clearInitialTasks();

            return false;

        }


        try {

            const response =
                await fetch(
                    "/api/calculate-age",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            birth_date:
                                birthDateInput.value,

                            screening_date:
                                screeningDateInput.value,

                            premature:
                                premature,

                            premature_weeks:
                                prematureWeeks

                        })

                    }
                );


            const result =
                await response.json();


            // =================================================
            // BACKEND ERROR
            // =================================================

            if (
                !response.ok ||
                !result.success
            ) {

                ageDisplay.textContent =
                    result.message ||
                    "Tanggal tidak valid.";

                ageBanner.textContent =
                    "Usia tidak valid";

                sessionStorage.removeItem(
                    "denverAge"
                );

                clearInitialTasks();

                return false;

            }


            // =================================================
            // AMBIL USIA FINAL DENVER II
            // =================================================

            const age =
                result.final_age;


            const ageText =
                `${age.years} Tahun ` +
                `${age.months} Bulan ` +
                `${age.days} Hari`;


            // =================================================
            // TAMPILKAN USIA
            // =================================================

            ageDisplay.textContent =
                ageText;

            ageBanner.textContent =
                ageText;


            // =================================================
            // SIMPAN HASIL USIA
            // =================================================

            sessionStorage.setItem(
                "denverAge",
                JSON.stringify(result)
            );
            return true;


            // =================================================
            // 11.3E
            // TAMPILKAN 3 TUGAS AWAL PER DOMAIN
            // =================================================



        } catch (error) {

            console.error(
                "Gagal menghitung usia:",
                error
            );


            ageDisplay.textContent =
                "Gagal menghitung usia.";

            ageBanner.textContent =
                "Gagal menghitung usia";


            sessionStorage.removeItem(
                "denverAge"
            );


            clearInitialTasks();

        }

    }

    async function updateAgePreview() {
        const ageBannerSebelumnya = ageBanner.textContent;

        const berhasil = await updateAge();

        if (berhasil) {
            // Usia kiri tetap tampil, usia kanan menunggu data disimpan.
            ageBanner.textContent = ageBannerSebelumnya;
            clearInitialTasks();
        }
    }

    birthDateInput.addEventListener("change", updateAgePreview);
    screeningDateInput.addEventListener("change", updateAgePreview);

    prematureWeeksInput.addEventListener("input", updateAgePreview);

    // =====================================================
    // PERUBAHAN TANGGAL LAHIR
    // =====================================================



    // =====================================================
    // PERUBAHAN TANGGAL SKRINING
    // =====================================================




    // =====================================================
    // PERUBAHAN STATUS PREMATUR
    // =====================================================

    prematureRadios.forEach(
        radio => {

            radio.addEventListener(
                "change",
                () => {


                    // -----------------------------------------
                    // PREMATUR = YA
                    // -----------------------------------------

                    if (
                        radio.value === "yes" &&
                        radio.checked
                    ) {

                        prematureWeeksGroup.style.display =
                            "flex";

                        prematureInfo.style.display =
                            "block";

                        prematureWeeksInput.required =
                            true;

                    }


                    // -----------------------------------------
                    // PREMATUR = TIDAK
                    // -----------------------------------------

                    if (
                        radio.value === "no" &&
                        radio.checked
                    ) {

                        prematureWeeksGroup.style.display =
                            "none";

                        prematureInfo.style.display =
                            "none";

                        prematureWeeksInput.required =
                            false;

                        prematureWeeksInput.value =
                            "";

                    }


                    // Hitung ulang usia
                    updateAgePreview();

                }
            );

        }
    );


    // =====================================================
    // PERUBAHAN JUMLAH MINGGU PREMATUR
    // =====================================================



    // =====================================================
    // RESET DATA ANAK
    // =====================================================
    function closeResetModal() {
        resetConfirmModal.hidden = true;
    }

    // Tombol Reset Form hanya membuka popup.
    resetChildButton.addEventListener("click", () => {
        resetConfirmModal.hidden = false;
    });

    // Batal atau klik area gelap menutup popup tanpa mengubah data.
    resetConfirmModal.querySelectorAll("[data-cancel-reset]").forEach(
        button => {
            button.addEventListener("click", closeResetModal);
        }
    );

    cancelResetButton.addEventListener("click", closeResetModal);

    // Tombol Ya, Reset menjalankan proses reset.

    confirmResetButton.addEventListener("click", () => {
        const form = document.getElementById("screeningForm");

        // Buka kunci form dan kosongkan data.
        form.querySelectorAll("input, select, textarea").forEach(element => {
            element.disabled = false;
        });

        form.reset();

        prematureWeeksGroup.style.display = "none";
        prematureInfo.style.display = "none";
        prematureWeeksInput.required = false;
        prematureWeeksInput.value = "";

        ageDisplay.textContent = "Akan dihitung otomatis";
        ageBanner.textContent = "Data Anak Belum Disimpan";

        sessionStorage.removeItem("childData");
        sessionStorage.removeItem("denverAge");
        sessionStorage.removeItem("screeningSaved");

        savedChildData = null;
        isEditingChild = false;

        clearInitialTasks();

        saveChildButton.hidden = false;
        resetChildButton.hidden = false;
        editChildButton.hidden = true;

        setScreeningSectionsLocked(false);
        const saveExamButtonAfterReset = document.getElementById("saveButton");
        if (saveExamButtonAfterReset) {
            saveExamButtonAfterReset.disabled = false;
            saveExamButtonAfterReset.textContent = hasExistingSavedExam
                ? "Simpan Pemeriksaan"
                : "Simpan Pemeriksaan";
        }

        resetConfirmModal.hidden = true;
    });


    // =====================================================
    // SIMPAN DATA ANAK
    // =====================================================

        
    function getChildFormData() {
        const form = document.getElementById("screeningForm");
        const data = Object.fromEntries(new FormData(form).entries());

        return data;
    }

    // Validasi jenis kelamin, pengukuran positif, dan format form.
    // Usia final dibatasi maksimal 73,2 bulan oleh endpoint calculate-age
    // sebelum konfirmasi penyimpanan, lalu divalidasi lagi di backend saat hasil disimpan.
    function validateChildInputs() {
        const form = document.getElementById("screeningForm");
        const genderInputs = form.querySelectorAll('input[name="gender"]');
        const genderMessage = document.getElementById("genderValidationMessage");
        const genderSelected = Array.from(genderInputs).some(input => input.checked);

        if (genderMessage) genderMessage.hidden = genderSelected;

        if (!genderSelected) {
            alert("Silakan pilih jenis kelamin anak terlebih dahulu.");
            if (genderInputs.length) genderInputs[0].focus();
            return false;
        }

        const measurements = [
            { input: document.getElementById("weight"), label: "Berat badan" },
            { input: document.getElementById("height"), label: "Tinggi badan" }
        ];

        for (const item of measurements) {
            const rawValue = String(item.input?.value ?? "").trim().replace(",", ".");
            const value = Number(rawValue);

            if (!rawValue || !Number.isFinite(value) || value <= 0) {
                alert(`${item.label} harus diisi dengan angka positif. Nilai desimal diperbolehkan.`);
                item.input?.focus();
                return false;
            }
        }

        if (!form.checkValidity()) {
            form.reportValidity();
            return false;
        }

        return true;
    }

    // Hilangkan pesan jenis kelamin segera setelah pengguna memilih opsi.
    document.querySelectorAll('input[name="gender"]').forEach(input => {
        input.addEventListener("change", () => {
            const message = document.getElementById("genderValidationMessage");
            if (message) message.hidden = true;
        });
    });

    function closeSaveModal() {
        saveConfirmModal.hidden = true;
    }

    function setChildFormLocked(locked) {
        const form = document.getElementById("screeningForm");

        form.querySelectorAll("input, select, textarea").forEach(element => {
            element.disabled = locked;
        });

        saveChildButton.hidden = locked;

        editChildButton.hidden = !locked;
    }

    function closeEditModal() {
        editConfirmModal.hidden = true;
    }

    function closeModalOnBackdrop(modal, selector, closeFunction) {
        modal.querySelectorAll(selector).forEach(element => {
            element.addEventListener("click", closeFunction);
        });
    }

    // Klik Simpan Data Anak: validasi data dan usia sebelum membuka konfirmasi.
    saveChildButton.addEventListener("click", async () => {
        if (!validateChildInputs()) return;

        const ageCalculated = await updateAge();
        if (!ageCalculated) {
            const message = ageDisplay.textContent ||
                "Usia anak tidak valid atau melebihi batas pemeriksaan.";
            alert(message);
            return;
        }

        saveConfirmModal.hidden = false;
    });

    cancelSaveButton.addEventListener("click", closeSaveModal);
    closeModalOnBackdrop(saveConfirmModal, "[data-cancel-save]", closeSaveModal);

    // Ya, Simpan: hitung usia, muat tugas, simpan data, lalu kunci form.
    confirmSaveButton.addEventListener("click", async () => {
        const form = document.getElementById("screeningForm");

        if (!validateChildInputs()) return;

        confirmSaveButton.disabled = true;

        try {
            const ageCalculated = await updateAge();

            if (!ageCalculated) return;

            const storedAge = sessionStorage.getItem("denverAge");
            if (!storedAge) {
                alert("Usia anak belum berhasil dihitung.");
                return;
            }

            const ageResult = JSON.parse(storedAge);

            // Jika tanggal atau data prematur berubah, mulai pemeriksaan baru.
            const currentData = getChildFormData();
            const previousData = savedChildData;

            const ageRelevantFields = [
                "birth_date",
                "screening_date",
                "premature",
                "premature_weeks"
            ];

            const ageInputsChanged = previousData &&
                ageRelevantFields.some(
                    field => String(previousData[field] ?? "") !==
                            String(currentData[field] ?? "")
                );

            if (isEditingChild && ageInputsChanged) {
                clearInitialTasks();
            }

            // Muat tugas berdasarkan usia terbaru.
            // Untuk penyimpanan pertama, tugas belum pernah dimuat.
            // Untuk edit data terkait usia, pemeriksaan dibuat ulang.
            // Untuk edit data non-usia, pertahankan hasil pemeriksaan.
            if (!isEditingChild || ageInputsChanged) {
                await loadInitialTasks(ageResult.final_age);
            }

            sessionStorage.setItem(
                "childData",
                JSON.stringify(currentData)
            );

            savedChildData = currentData;
            isEditingChild = false;

            setChildFormLocked(true);
            setScreeningSectionsLocked(false);
            closeSaveModal();

            alert("Data anak berhasil disimpan.");
        } catch (error) {
            console.error("Gagal menyimpan data anak:", error);
            alert("Gagal memproses data anak atau memuat tugas. Silakan coba lagi.");
        } finally {
            confirmSaveButton.disabled = false;
        }
    });

    // Klik Edit Data Anak: minta konfirmasi terlebih dahulu.
    editChildButton.addEventListener("click", () => {
        editConfirmModal.hidden = false;
    });

    cancelEditButton.addEventListener("click", closeEditModal);
    closeModalOnBackdrop(editConfirmModal, "[data-cancel-edit]", closeEditModal);

    confirmEditButton.addEventListener("click", () => {
        closeEditModal();

        // Setelah masuk mode edit, hasil sesi ini dianggap belum disimpan ulang.
        sessionStorage.removeItem("screeningSaved");
        const saveButtonAfterEdit = document.getElementById("saveButton");
        if (saveButtonAfterEdit) {
            saveButtonAfterEdit.disabled = false;
            saveButtonAfterEdit.textContent = hasExistingSavedExam
                ? "Simpan Pemeriksaan"
                : "Simpan Pemeriksaan";
        }

        isEditingChild = true;
        setChildFormLocked(false);

        // Cegah jawaban pemeriksaan diubah saat data sedang diedit.
        setScreeningSectionsLocked(true);
    });

    const resetExamButton = document.getElementById("resetButton");

    const resetExamConfirmModal =
        document.getElementById("resetExamConfirmModal");

    const cancelResetExamButton =
        document.getElementById("cancelResetExamButton");

    const confirmResetExamButton =
        document.getElementById("confirmResetExamButton");

    function closeResetExamModal() {
        resetExamConfirmModal.hidden = true;
    }

    // Klik Reset Pemeriksaan hanya membuka popup.
    if (resetExamButton) {
        resetExamButton.addEventListener("click", () => {
            resetExamConfirmModal.hidden = false;
        });
    }

    // Batal atau klik area gelap menutup popup.
    cancelResetExamButton.addEventListener(
        "click",
        closeResetExamModal
    );

    resetExamConfirmModal
        .querySelectorAll("[data-cancel-reset-exam]")
        .forEach(button => {
            button.addEventListener("click", closeResetExamModal);
        });

    // Reset baru dilakukan setelah pengguna mengonfirmasi.
    confirmResetExamButton.addEventListener("click", async () => {
        confirmResetExamButton.disabled = true;

        try {
            const stored = sessionStorage.getItem("denverAge");

            if (!stored) {
                clearInitialTasks();
                resetExamConfirmModal.hidden = true;
                return;
            }

            const parsed = JSON.parse(stored);

            // Reset pemeriksaan harus menghapus jawaban dan tugas tambahan yang tersimpan.
            sessionStorage.removeItem("denverDomainState");
            sessionStorage.removeItem("screeningSaved");
            await loadInitialTasks(parsed.final_age);
            setScreeningSectionsLocked(false);
            if (saveExamButton) {
                saveExamButton.disabled = false;
                saveExamButton.textContent = hasExistingSavedExam
                    ? "Simpan Pemeriksaan"
                    : "Simpan Pemeriksaan";
            }

            resetExamConfirmModal.hidden = true;
        } catch (error) {
            console.error("Gagal mereset pemeriksaan:", error);
            alert("Pemeriksaan gagal direset. Silakan coba kembali.");
        } finally {
            confirmResetExamButton.disabled = false;
        }
    });




    // =====================================================
    // PULIHKAN DATA SAAT KEMBALI KE HALAMAN UTAMA
    // =====================================================
    async function restoreStoredSession() {
        const storedChild = sessionStorage.getItem("childData");
        const storedAge = sessionStorage.getItem("denverAge");
        if (!storedChild) return;

        try {
            const data = JSON.parse(storedChild);
            const form = document.getElementById("screeningForm");

            Object.entries(data).forEach(([name, value]) => {
                const controls = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
                controls.forEach(control => {
                    if (control.type === "radio") {
                        control.checked = control.value === String(value);
                    } else if (control.type !== "checkbox") {
                        control.value = value ?? "";
                    }
                });
            });

            const prematureYes = data.premature === "yes";
            prematureWeeksGroup.style.display = prematureYes ? "flex" : "none";
            prematureInfo.style.display = prematureYes ? "block" : "none";
            prematureWeeksInput.required = prematureYes;

            savedChildData = data;
            setChildFormLocked(true);

            if (storedAge) {
                const ageResult = JSON.parse(storedAge);
                const age = ageResult.final_age;
                if (age) {
                    ageDisplay.textContent = `${age.years} Tahun ${age.months} Bulan ${age.days} Hari`;
                    ageBanner.textContent = ageDisplay.textContent;
                    await loadInitialTasks(age);
                    if (sessionStorage.getItem("screeningSaved") === "true") {
                        // Pemeriksaan yang sudah disimpan dikunci, tetapi hasil tetap bisa dibuka.
                        setScreeningSectionsLocked(true);
                        const saveExamButton = document.getElementById("saveButton");
                        if (saveExamButton) {
                            saveExamButton.disabled = false;
                            saveExamButton.textContent = "Lihat Hasil";
                            saveExamButton.dataset.saved = "true";
                        }
                    } else {
                        setScreeningSectionsLocked(false);
                    }
                }
            }
        } catch (error) {
            console.error("Gagal memulihkan data pemeriksaan:", error);
        }
    }


    // =====================================================
    // SIMPAN PEMERIKSAAN DAN BUKA HALAMAN HASIL
    // =====================================================
    const saveExamButton = document.getElementById("saveButton");
    const saveExamConfirmModal = document.getElementById("saveExamConfirmModal");
    const cancelSaveExamButton = document.getElementById("cancelSaveExamButton");
    const confirmSaveExamButton = document.getElementById("confirmSaveExamButton");

    function closeSaveExamModal() {
        if (saveExamConfirmModal) saveExamConfirmModal.hidden = true;
    }

    function setSaveExamButtonSaved(saved) {
        hasExistingSavedExam = Boolean(saved);
        if (!saveExamButton) return;

        const currentSessionAlreadySaved =
            sessionStorage.getItem("screeningSaved") === "true";

        if (currentSessionAlreadySaved) {
            // Status simpan tidak boleh menghilangkan akses ke halaman hasil.
            saveExamButton.textContent = "Lihat Hasil";
            saveExamButton.disabled = false;
            saveExamButton.removeAttribute("aria-disabled");
            saveExamButton.style.opacity = "1";
            saveExamButton.style.cursor = "pointer";
            saveExamButton.dataset.saved = "true";
            return;
        }

        saveExamButton.textContent = hasExistingSavedExam
            ? "Simpan Pemeriksaan"
            : "Simpan Pemeriksaan";
        saveExamButton.disabled = false;
        saveExamButton.dataset.saved = "false";
    }

    async function checkExistingSavedExam() {
        if (!saveExamButton) return;
        try {
            const response = await fetch("/api/screening/current", { cache: "no-store" });
            const result = await response.json();
            setSaveExamButtonSaved(Boolean(response.ok && result.success && result.saved));
        } catch (error) {
            console.warn("Status hasil pemeriksaan tersimpan belum dapat diperiksa.", error);
            setSaveExamButtonSaved(false);
        }
    }

    function getIncompleteDomains() {
        const incomplete = [];
        Object.entries(DOMAIN_STATE).forEach(([domain, state]) => {
            const tasks = allTasks(state);
            const allTasksAnswered = tasks.length > 0 &&
                tasks.every(task => state.answers[task.id] === "P" || state.answers[task.id] === "F");
            const terminal = Boolean(state.completed || state.exhausted);
            if (!terminal || !allTasksAnswered) {
                incomplete.push(DOMAIN_NAMES[domain] || domain);
            }
        });
        return incomplete;
    }

    if (saveExamButton) {
        saveExamButton.addEventListener("click", async () => {
            // Jika sesi ini sudah tersimpan, tombol berfungsi sebagai pintasan ke hasil.
            if (sessionStorage.getItem("screeningSaved") === "true") {
                window.location.href = "/result";
                return;
            }

            if (!savedChildData || !sessionStorage.getItem("denverAge")) {
                alert("Data anak belum disimpan. Lengkapi dan simpan data anak terlebih dahulu.");
                return;
            }

            const incomplete = getIncompleteDomains();
            if (incomplete.length) {
                alert(
                    "Hasil pemeriksaan belum bisa disimpan. Selesaikan semua tugas P/F seluruh pada domain terlebih dahulu."
                );
                return;
            }

            const message = document.getElementById("saveExamConfirmMessage");
            if (message) {
                message.textContent = hasExistingSavedExam
                    ? "Pastikan data anak dan seluruh jawaban hasil pemeriksaan (P/F) sudah benar sebelum menyimpan hasil."
                    : "Pastikan data anak dan seluruh jawaban hasil pemeriksaan (P/F) sudah benar sebelum menyimpan hasil";
            }
            saveExamConfirmModal.hidden = false;
        });
    }

    if (cancelSaveExamButton) {
        cancelSaveExamButton.addEventListener("click", closeSaveExamModal);
    }
    if (saveExamConfirmModal) {
        saveExamConfirmModal.querySelectorAll("[data-cancel-save-exam]").forEach(element => {
            element.addEventListener("click", closeSaveExamModal);
        });
    }

    if (confirmSaveExamButton) {
        confirmSaveExamButton.addEventListener("click", async () => {
            confirmSaveExamButton.disabled = true;
            const oldText = confirmSaveExamButton.textContent;
            confirmSaveExamButton.textContent = "Menyimpan...";
            try {
                const ageRecord = JSON.parse(sessionStorage.getItem("denverAge") || "null");
                const age = ageRecord && ageRecord.final_age;
                if (!savedChildData || !age) {
                    throw new Error("Data anak atau usia belum tersedia. Simpan data anak kembali.");
                }

                const domains = {};
                Object.entries(DOMAIN_STATE).forEach(([domain, state]) => {
                    const answers = state.answers || {};
                    const tasks = [...state.initialTasks, ...state.additionalTasks];
                    const pass = Object.values(answers).filter(value => value === "P").length;
                    const fail = Object.values(answers).filter(value => value === "F").length;
                    domains[domain] = {
                        name: DOMAIN_NAMES[domain] || domain,
                        pass,
                        fail,
                        answered: pass + fail,
                        total_displayed: tasks.length,
                        completed: Boolean(state.completed),
                        exhausted: Boolean(state.exhausted),
                        tasks: tasks.map(task => ({
                            id: task.id,
                            name: task.name,
                            reportable: Boolean(task.reportable),
                            answer: answers[task.id] || ""
                        })).filter(task => task.answer)
                    };
                });

                const payload = {
                    child: savedChildData,
                    age,
                    domains,
                    total_tasks: Object.values(domains).reduce((sum, domain) => sum + domain.answered, 0),
                    saved_at: new Date().toISOString()
                };

                const response = await fetch("/api/screening/save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.message || "Hasil pemeriksaan gagal disimpan.");
                }

                sessionStorage.setItem("screeningSaved", "true");
                closeSaveExamModal();
                setSaveExamButtonSaved(true);
                window.location.href = "/result?updated=" + Date.now();
            } catch (error) {
                console.error("Gagal menyimpan hasil pemeriksaan:", error);
                alert(error.message || "Hasil pemeriksaan gagal disimpan. Silakan coba kembali.");
            } finally {
                confirmSaveExamButton.disabled = false;
                confirmSaveExamButton.textContent = oldText;
            }
        });
    }

    checkExistingSavedExam();

    restoreStoredSession();

});