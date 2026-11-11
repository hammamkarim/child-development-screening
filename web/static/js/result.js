document.addEventListener("DOMContentLoaded", async () => {
    const DOMAIN_ORDER = [
        ["personal_social", "Personal Sosial", "👥"],
        ["fine_motor_adaptive", "Adaptif-Motorik Halus", "🧩"],
        ["language", "Bahasa", "💬"],
        ["gross_motor", "Motorik Kasar", "🏃"]
    ];

    const STATUS_INFO = {
        advanced: { label: "Advanced", className: "status-advanced" },
        normal: { label: "Normal", className: "status-normal" },
        caution: { label: "Caution", className: "status-caution" },
        delayed: { label: "Delayed", className: "status-delayed" },
        unknown: { label: "Belum dapat ditentukan", className: "status-unknown" }
    };

    const byId = id => document.getElementById(id);
    let currentAiResult = null;
    const safeText = (id, value) => {
        const el = byId(id);
        if (el) el.textContent = value ?? "—";
    };

    const fullDiagramButton = byId("viewFullDiagramButton");
    if (fullDiagramButton) {
        fullDiagramButton.addEventListener("click", () => {
            const detailUrl = fullDiagramButton.dataset.detailUrl || "/detail";
            window.location.href = detailUrl;
        });
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString("id-ID", {
            day: "2-digit", month: "2-digit", year: "numeric"
        });
    }

    function formatAxisDate(value) {
        if (!value) return "Tanggal pemeriksaan";
        // Baca tanggal ISO sebagai teks agar tidak bergeser karena zona waktu browser.
        const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) return `${match[3]}-${match[2]}-${match[1]}`;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return `${String(parsed.getDate()).padStart(2, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${parsed.getFullYear()}`;
    }

    const PREVIEW_DOMAIN_META = {
        personal_social: { label: "PERSONAL SOSIAL", color: "#7451a6" },
        fine_motor_adaptive: { label: "ADAPTIF-MOTORIK HALUS", color: "#6a9d39" },
        language: { label: "BAHASA", color: "#d97706" },
        gross_motor: { label: "MOTORIK KASAR", color: "#8a65d6" }
    };
    const PREVIEW_SVG_NS = "http://www.w3.org/2000/svg";
    const PREVIEW_WIDTH = 1900;
    const PREVIEW_LEFT = 235;
    const PREVIEW_RIGHT = 35;
    const PREVIEW_TOP = 94;
    const PREVIEW_AXIS_INTERVALS = 40;
    const PREVIEW_SCALE = (PREVIEW_WIDTH - PREVIEW_LEFT - PREVIEW_RIGHT) / PREVIEW_AXIS_INTERVALS;

    function previewXForMonth(month) {
        const value = Math.max(0, Math.min(72, Number(month) || 0));
        const units = value <= 24 ? value : 24 + (value - 24) / 3;
        return PREVIEW_LEFT + units * PREVIEW_SCALE;
    }

    function previewSvgEl(name, attrs = {}, text = null) {
        const element = document.createElementNS(PREVIEW_SVG_NS, name);
        Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
        if (text !== null) element.textContent = text;
        return element;
    }

    function previewPercentile(task, key) {
        const aliases = {
            p25_month: ["p25_month", "p25", "percentile_25", "p25Month"],
            p50_month: ["p50_month", "p50", "percentile_50", "p50Month"],
            p75_month: ["p75_month", "p75", "percentile_75", "p75Month"],
            p90_month: ["p90_month", "p90", "percentile_90", "p90Month"]
        };
        for (const name of aliases[key] || [key]) {
            const raw = task?.[name];
            if (raw === null || raw === undefined || raw === "") continue;
            const value = typeof raw === "string" ? Number(raw.trim().replace(",", ".")) : Number(raw);
            if (Number.isFinite(value)) return value;
        }
        return null;
    }

    function previewTaskStart(task) {
        for (const key of ["p25_month", "p50_month", "p75_month", "p90_month"]) {
            const value = previewPercentile(task, key);
            if (value !== null) return value;
        }
        return 0;
    }

    async function renderDiagramPreview(screening, masterTasks) {
        const svg = byId("resultDenverPreview");
        const summary = byId("resultDiagramSummary");
        const countLabel = byId("resultDiagramTaskCount");
        const notice = byId("resultDiagramNotice");
        if (!svg || !summary || !countLabel || !notice) return;

        const masterById = new Map((masterTasks || []).map(task => [String(task.id ?? task.task_id ?? ""), task]));
        const answered = [];
        const domains = screening.domains || {};
        Object.keys(PREVIEW_DOMAIN_META).forEach(domainKey => {
            const domain = domains[domainKey] || {};
            (Array.isArray(domain.tasks) ? domain.tasks : []).forEach(answerTask => {
                const answer = String(answerTask?.answer || "").trim().toUpperCase();
                const id = String(answerTask?.id ?? answerTask?.task_id ?? "");
                const master = masterById.get(id);
                if (!master || (answer !== "P" && answer !== "F")) return;
                answered.push({ ...master, answer, domain: domainKey, isInitial: false });
            });
        });

        if (!answered.length) {
            svg.innerHTML = "";
            svg.setAttribute("viewBox", "0 0 900 150");
            svg.setAttribute("width", "900");
            svg.setAttribute("height", "150");
            svg.appendChild(previewSvgEl("text", { x: 24, y: 52, fill: "#64748b", "font-size": 18 }, "Belum ada tugas P/F yang dapat ditampilkan."));
            summary.textContent = "Diagram akan ditampilkan setelah hasil pemeriksaan tersimpan.";
            countLabel.textContent = "0 tugas ditampilkan";
            return;
        }

        // Identifikasi tugas awal dengan aturan pemilihan yang sama seperti diagram utama.
        const age = screening.age || {};
        let initialIds = new Set();
        if ([age.years, age.months, age.days].every(value => value !== undefined && value !== null && Number.isFinite(Number(value)))) {
            try {
                const response = await fetch("/api/denver/initial-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ age })
                });
                const result = await response.json();
                if (response.ok && result.success && result.tasks) {
                    Object.values(result.tasks).flat().forEach(task => initialIds.add(String(task.id ?? task.task_id ?? "")));
                }
            } catch (error) {
                console.warn("Daftar tugas awal tidak berhasil dimuat untuk preview.", error);
            }
        }
        answered.forEach(task => { task.isInitial = initialIds.has(String(task.id)); });

        const ageMonths = getAgeMonths(age);
        const ageX = ageMonths === null ? null : previewXForMonth(ageMonths);
        const rowHeight = 29;
        const domainHeaderHeight = 29;
        const domainGap = 8;
        let totalHeight = PREVIEW_TOP;
        const domainRows = [];
        Object.keys(PREVIEW_DOMAIN_META).forEach(domainKey => {
            const list = answered.filter(task => task.domain === domainKey).sort((a, b) => {
                const num = item => Number((String(item.id).match(/(\d+)$/) || [0, 0])[1]);
                return num(a) - num(b);
            });
            if (!list.length) return;
            const y = totalHeight;
            const height = domainHeaderHeight + list.length * rowHeight;
            domainRows.push({ key: domainKey, meta: PREVIEW_DOMAIN_META[domainKey], tasks: list, y, height });
            totalHeight += height + domainGap;
        });
        totalHeight += 50;
        svg.innerHTML = "";
        svg.setAttribute("viewBox", `0 0 ${PREVIEW_WIDTH} ${totalHeight}`);
        svg.setAttribute("width", PREVIEW_WIDTH);
        svg.setAttribute("height", totalHeight);
        svg.appendChild(previewSvgEl("rect", { x: 0, y: 0, width: PREVIEW_WIDTH, height: totalHeight, fill: "#fff" }));

        // Sumbu usia ditampilkan di atas dan bawah agar rentang usia tetap terbaca saat menggulir.
        const axisY = PREVIEW_TOP - 12;
        const bottomAxisY = totalHeight - 30;
        svg.appendChild(previewSvgEl("text", { x: PREVIEW_LEFT, y: 17, fill: "#64748b", "font-size": 11, "font-weight": 800 }, "USIA (BULAN / TAHUN)"));
        svg.appendChild(previewSvgEl("line", { x1: PREVIEW_LEFT, y1: axisY, x2: PREVIEW_WIDTH - PREVIEW_RIGHT, y2: axisY, stroke: "#8793a5", "stroke-width": 1.2 }));
        svg.appendChild(previewSvgEl("line", { x1: PREVIEW_LEFT, y1: bottomAxisY, x2: PREVIEW_WIDTH - PREVIEW_RIGHT, y2: bottomAxisY, stroke: "#8793a5", "stroke-width": 1.2 }));
        const ticks = [];
        for (let month = 0; month <= 24; month += 2) ticks.push(month);
        for (let month = 27; month <= 72; month += 3) ticks.push(month);
        const tickLabels = new Map();
        ticks.forEach(month => {
            const x = previewXForMonth(month);
            const label = month < 24 ? String(month) : month === 24 ? "24 bln" : `${month / 12} th`;
            tickLabels.set(month, label);
            svg.appendChild(previewSvgEl("line", { x1: x, y1: axisY + 2, x2: x, y2: bottomAxisY - 2, stroke: "#edf0f5", "stroke-width": 1 }));
            svg.appendChild(previewSvgEl("line", { x1: x, y1: axisY - 1, x2: x, y2: axisY + 5, stroke: "#8793a5", "stroke-width": 1 }));
            svg.appendChild(previewSvgEl("text", { x, y: axisY - 7, fill: "#526176", "font-size": 10, "font-weight": 700, "text-anchor": "middle" }, label));
            svg.appendChild(previewSvgEl("line", { x1: x, y1: bottomAxisY - 5, x2: x, y2: bottomAxisY + 1, stroke: "#8793a5", "stroke-width": 1 }));
            svg.appendChild(previewSvgEl("text", { x, y: bottomAxisY + 15, fill: "#526176", "font-size": 10, "font-weight": 700, "text-anchor": "middle" }, label));
        });

        domainRows.forEach((domain, domainIndex) => {
            svg.appendChild(previewSvgEl("rect", { x: 8, y: domain.y, width: PREVIEW_WIDTH - 16, height: domain.height, rx: 7, fill: domainIndex % 2 ? "#fbfcfe" : "#fff", stroke: "#e2e8f0", "stroke-width": 1 }));
            svg.appendChild(previewSvgEl("rect", { x: 8, y: domain.y, width: PREVIEW_WIDTH - 16, height: domainHeaderHeight, rx: 7, fill: "#f4f7fb" }));
            svg.appendChild(previewSvgEl("text", { x: 20, y: domain.y + 19, fill: domain.meta.color, "font-size": 11, "font-weight": 900 }, `${domain.meta.label} · ${domain.tasks.length} TUGAS`));

            domain.tasks.forEach((task, index) => {
                const y = domain.y + domainHeaderHeight + index * rowHeight + 2;
                const start = previewTaskStart(task);
                const p75 = previewPercentile(task, "p75_month");
                const p90 = previewPercentile(task, "p90_month");
                const end = p90 === null ? start : p90;
                const xStart = previewXForMonth(start);
                const xEnd = previewXForMonth(end);
                const barWidth = Math.max(18, xEnd - xStart);
                const x50 = previewPercentile(task, "p50_month");
                const pAnswer = task.answer === "P";
                const answerX = Math.max(177, xStart - 30);
                svg.appendChild(previewSvgEl("rect", { x: 18, y: y + 3, width: 8, height: 8, rx: 2, fill: task.isInitial ? "#3475ee" : "#ff873e" }));
                svg.appendChild(previewSvgEl("text", { x: 31, y: y + 12, fill: "#596579", "font-size": 9.5 }, task.name.length > 25 ? `${task.name.slice(0, 24)}…` : task.name));
                svg.appendChild(previewSvgEl("rect", { x: answerX, y: y + 1, width: 23, height: 20, rx: 5, fill: pAnswer ? "#dcfce7" : "#fee2e2", stroke: pAnswer ? "#86d49b" : "#fca5a5", "stroke-width": 1 }));
                svg.appendChild(previewSvgEl("text", { x: answerX + 11.5, y: y + 15, fill: pAnswer ? "#166534" : "#b91c1c", "font-size": 11, "font-weight": 900, "text-anchor": "middle" }, task.answer));

                const taskBar = previewSvgEl("rect", { x: xStart, y, width: barWidth, height: 22, rx: 2, fill: task.isInitial ? "#eaf1ff" : "#fffaf6", stroke: task.isInitial ? "#3475ee" : "#ff873e", "stroke-width": task.isInitial ? 1.8 : 1.1 });
                taskBar.appendChild(previewSvgEl("title", {}, `${String(task.name || "Tugas perkembangan")}\nHasil: ${task.answer === "P" ? "Berhasil (P)" : "Gagal (F)"}\nJenis: ${task.isInitial ? "Tugas awal" : "Tugas tambahan"}`));
                svg.appendChild(taskBar);
                if (p75 !== null && p90 !== null && p90 > p75) {
                    const greenX = previewXForMonth(p75);
                    svg.appendChild(previewSvgEl("rect", { x: greenX, y: y + 1, width: Math.max(1, previewXForMonth(p90) - greenX), height: 20, fill: "#ccebd2", stroke: "#8cc797", "stroke-width": .5 }));
                }
                if (x50 !== null) {
                    const medianX = previewXForMonth(x50);
                    svg.appendChild(previewSvgEl("line", { x1: medianX, y1: y + 1, x2: medianX, y2: y + 8, stroke: "#4b5563", "stroke-width": 1 }));
                }
                const labelStart = xStart + 5;
                const availableInside = xEnd - xStart - 10;
                const fullName = String(task.name || "Tugas perkembangan");
                const clippedName = fullName.length > 42 ? `${fullName.slice(0, 41)}…` : fullName;
                if (availableInside > 125) {
                    svg.appendChild(previewSvgEl("text", { x: labelStart, y: y + 14, fill: "#263b2b", "font-size": 9.5, "font-weight": 650, "pointer-events": "none" }, clippedName));
                } else {
                    const labelX = Math.min(PREVIEW_WIDTH - PREVIEW_RIGHT - 8, xEnd + 7);
                    const maxChars = Math.max(8, Math.floor((PREVIEW_WIDTH - PREVIEW_RIGHT - labelX) / 5.5));
                    const shortLabel = fullName.length > maxChars ? `${fullName.slice(0, Math.max(5, maxChars - 1))}…` : fullName;
                    svg.appendChild(previewSvgEl("text", { x: labelX, y: y + 14, fill: "#263b2b", "font-size": 9.5, "font-weight": 650, "pointer-events": "none" }, shortLabel));
                }
                taskBar.setAttribute("aria-label", `${fullName}, hasil ${task.answer}, ${task.isInitial ? "tugas awal" : "tugas tambahan"}`);
            });
        });

        if (ageX !== null) {
            const dateLabel = formatAxisDate(screening.child?.screening_date);
            svg.appendChild(previewSvgEl("line", { x1: ageX, y1: 49, x2: ageX, y2: bottomAxisY, stroke: "#3475ee", "stroke-width": 2.2, "stroke-dasharray": "7 5", opacity: .95 }));
            svg.appendChild(previewSvgEl("rect", { x: Math.max(PREVIEW_LEFT, Math.min(PREVIEW_WIDTH - PREVIEW_RIGHT - 104, ageX - 52)), y: 25, width: 104, height: 22, rx: 5, fill: "#3475ee" }));
            svg.appendChild(previewSvgEl("text", { x: Math.max(PREVIEW_LEFT + 52, Math.min(PREVIEW_WIDTH - PREVIEW_RIGHT - 52, ageX)), y: 40, fill: "#fff", "font-size": 10, "font-weight": 800, "text-anchor": "middle" }, dateLabel));
        }

        const passCount = answered.filter(task => task.answer === "P").length;
        const failCount = answered.filter(task => task.answer === "F").length;
        summary.textContent = `Diagram menampilkan ${answered.length} tugas yang diperiksa: ${passCount} berhasil (P) dan ${failCount} gagal (F). Tugas awal berbingkai biru dan tugas tambahan berbingkai jingga.`;
        countLabel.textContent = `${answered.length} tugas ditampilkan`;
    }

    function renderSummary(screening) {
        const domains = screening.domains || {};
        const total = Number(screening.total_tasks) ||
            Object.values(domains).reduce((sum, item) => sum + (Number(item.answered) || 0), 0);
        safeText("resultTotalTasks", total);

        const container = byId("resultDomainSummary");
        if (!container) return;
        container.innerHTML = "";

        DOMAIN_ORDER.forEach(([key, fallbackName, icon]) => {
            const item = domains[key] || {};
            const row = document.createElement("div");
            row.className = "domain-summary-item";

            const name = document.createElement("div");
            name.className = "domain-summary-name";
            const iconEl = document.createElement("span");
            iconEl.className = "domain-summary-icon";
            iconEl.textContent = icon;
            const nameText = document.createElement("span");
            nameText.textContent = item.name || fallbackName;
            name.append(iconEl, nameText);

            const pass = document.createElement("span");
            pass.className = "summary-count summary-pass";
            pass.textContent = `Pass: ${Number(item.pass) || 0}`;

            const fail = document.createElement("span");
            fail.className = "summary-count summary-fail";
            fail.textContent = `Fail: ${Number(item.fail) || 0}`;

            row.append(name, pass, fail);
            container.appendChild(row);
        });
    }

    function renderChild(screening) {
        const child = screening.child || {};
        const age = screening.age || {};
        safeText("resultExaminer", child.examiner_name || "—");
        safeText("resultChildName", child.child_name || "—");
        safeText("resultScreeningDate", formatDate(child.screening_date));
        safeText("resultBirthDate", formatDate(child.birth_date));
        safeText("resultAge", age.years !== undefined
            ? `${age.years} Tahun ${age.months} Bulan ${age.days} Hari`
            : "—");
        safeText("resultGender", child.gender || "—");
        safeText("resultWeight", child.weight !== undefined && child.weight !== "" ? `${child.weight} kg` : "—");
        safeText("resultHeight", child.height !== undefined && child.height !== "" ? `${child.height} cm` : "—");
        safeText("resultPremature", child.premature === "yes"
            ? `Ya${child.premature_weeks ? ` (${child.premature_weeks} minggu)` : ""}`
            : child.premature === "no" ? "Tidak" : "—");
    }

    function numericPercentile(task, key) {
        // Mendukung beberapa nama kolom yang mungkin dikembalikan API.
        const aliases = {
            p25_month: ["p25_month", "p25", "percentile_25", "p25Month"],
            p50_month: ["p50_month", "p50", "percentile_50", "p50Month"],
            p75_month: ["p75_month", "p75", "percentile_75", "p75Month"],
            p90_month: ["p90_month", "p90", "percentile_90", "p90Month"]
        };
        const candidates = aliases[key] || [key];

        for (const candidate of candidates) {
            const raw = task?.[candidate];
            if (raw === null || raw === undefined || raw === "") continue;

            // Mengakomodasi angka desimal dengan koma jika API mengirim string.
            const value = typeof raw === "string"
                ? Number(raw.trim().replace(",", "."))
                : Number(raw);
            if (Number.isFinite(value)) return value;
        }
        return null;
    }

    function normalizeTaskKey(value) {
        return String(value ?? "")
            .normalize("NFKD")
            .replace(/[\\u0300-\\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
    }

    function getTaskId(task) {
        return task?.id ?? task?.task_id ?? task?.taskId ?? task?.code ?? task?.item_id;
    }

    function getTaskName(task) {
        return task?.name ?? task?.task_name ?? task?.taskName ?? task?.label ?? task?.title;
    }

    function findMasterTask(answerTask, taskMap, taskNameMap) {
        const id = getTaskId(answerTask);
        if (id !== undefined && id !== null) {
            const byId = taskMap.get(String(id));
            if (byId) return byId;
        }

        const nameKey = normalizeTaskKey(getTaskName(answerTask));
        return nameKey ? taskNameMap.get(nameKey) || null : null;
    }

    function getAgeMonths(age) {
        if (!age || age.years === undefined || age.months === undefined || age.days === undefined) {
            return null;
        }
        const years = Number(age.years);
        const months = Number(age.months);
        const days = Number(age.days);
        if (![years, months, days].every(Number.isFinite)) return null;
        return years * 12 + months + days / 30;
    }

    /*
     * Interpretasi domain berdasarkan aturan pengguna:
     * 1. P pada tugas yang seluruh rentang persentil validnya berada di kanan garis umur => Advanced.
     * 2. Jika tidak Advanced, P pada P25 sampai sebelum P75 => Normal.
     * 3. F pada P75-P90 => Caution, kecuali seluruh tugas P75-P90 gagal
     *    dan ada F pada tugas yang sepenuhnya di kiri garis umur; kondisi itu Delayed.
     * 4. Jika tidak ada F pada P75-P90 tetapi ada tugas pada rentang tersebut => Normal,
     *    tanpa dipengaruhi kegagalan di rentang lain.
     * 5. Jika tidak ada tugas P75-P90, semua tugas terjawab di kiri garis umur harus P
     *    agar Normal; jika ada F di kiri garis umur => Delayed.
     */
    function interpretDomain(domain, ageMonths, taskMap, taskNameMap) {
        const tasks = Array.isArray(domain?.tasks) ? domain.tasks : [];
        if (ageMonths === null) return "unknown";

        let hasAdvanced = false;
        let hasNormalPass = false;
        let p75P90TaskCount = 0;
        let p75P90PassCount = 0;
        let p75P90FailCount = 0;
        let leftOfAgeAnsweredCount = 0;
        let leftOfAgeFailCount = 0;

        for (const answerTask of tasks) {
            const answer = String(answerTask?.answer || "").trim().toUpperCase();
            if (answer !== "P" && answer !== "F") continue;

            const master = findMasterTask(answerTask, taskMap, taskNameMap);
            if (!master) continue;

            const p25 = numericPercentile(master, "p25_month");
            const p50 = numericPercentile(master, "p50_month");
            const p75 = numericPercentile(master, "p75_month");
            const p90 = numericPercentile(master, "p90_month");

            // Birth hanya dikenali jika P90 secara eksplisit bernilai 0
            // dan persentil lainnya memang tidak tersedia. Null saja bukan Birth.
            const isBirthTask = p90 === 0 && p25 === null && p50 === null && p75 === null;

            if (isBirthTask) {
                if (ageMonths === 0) {
                    // Pada usia tepat 0 hari, tugas Birth diperlakukan seperti P90.
                    p75P90TaskCount += 1;
                    if (answer === "P") p75P90PassCount += 1;
                    else p75P90FailCount += 1;
                } else {
                    // Setelah usia 0 hari, tugas Birth sepenuhnya di kiri garis umur.
                    leftOfAgeAnsweredCount += 1;
                    if (answer === "F") leftOfAgeFailCount += 1;
                }
                continue;
            }

            // Pengecualian Follow to Midline sebelum 0,3967 bulan:
            // P => Advanced; F => Normal karena tugas belum waktunya.
            const masterId = String(getTaskId(master) ?? "").trim().toUpperCase();
            const masterName = normalizeTaskKey(getTaskName(master));
            const isFollowToMidline =
                masterId === "FM_001" ||
                masterName === normalizeTaskKey("Mengikuti ke Garis Tengah") ||
                masterName === normalizeTaskKey("Follow to Midline");

            if (isFollowToMidline && ageMonths < 0.3967) {
                if (answer === "P") hasAdvanced = true;
                else hasNormalPass = true;
                continue;
            }

            // Tugas berhasil sepenuhnya di kanan garis umur:
            // usia lebih kecil dari persentil valid paling awal yang tersedia.
            const earliestValidPercentile = [p25, p50, p75, p90]
                .find(value => value !== null);
            if (answer === "P" &&
                earliestValidPercentile !== undefined &&
                ageMonths < earliestValidPercentile) {
                hasAdvanced = true;
            }

            // Normal: tugas berhasil pada P25 sampai sebelum P75.
            if (answer === "P" && p25 !== null && p75 !== null &&
                ageMonths >= p25 && ageMonths < p75) {
                hasNormalPass = true;
            }

            // Catat semua tugas terjawab saat garis umur berada pada P75-P90.
            const inP75P90 = p75 !== null && p90 !== null &&
                ageMonths >= p75 && ageMonths <= p90;
            if (inP75P90) {
                p75P90TaskCount += 1;
                if (answer === "P") p75P90PassCount += 1;
                else p75P90FailCount += 1;
            }

            // Tugas sepenuhnya di kiri garis umur: usia lebih besar dari P90.
            if (p90 !== null && ageMonths > p90) {
                leftOfAgeAnsweredCount += 1;
                if (answer === "F") leftOfAgeFailCount += 1;
            }
        }

        // Prioritas utama: Advanced, lalu Normal dari keberhasilan P25-P75.
        if (hasAdvanced) return "advanced";
        if (hasNormalPass) return "normal";

        // Ada kegagalan P75-P90:
        // - jika semuanya gagal dan ada kegagalan di kiri garis umur => Delayed;
        // - selain itu => Caution.
        if (p75P90FailCount > 0) {
            const allP75P90TasksFailed =
                p75P90TaskCount > 0 && p75P90PassCount === 0;

            if (allP75P90TasksFailed && leftOfAgeFailCount > 0) {
                return "delayed";
            }
            return "caution";
        }

        // Ada tugas P75-P90 dan semuanya berhasil => Normal,
        // meskipun tugas lain di kiri garis umur gagal.
        if (p75P90TaskCount > 0) return "normal";

        // Jika tidak ada tugas P75-P90, kegagalan di kiri garis umur mutlak Delayed.
        if (leftOfAgeFailCount > 0) return "delayed";

        // Tanpa tugas P75-P90, Normal hanya jika ada tugas kiri yang dijawab
        // dan seluruh tugas tersebut berhasil.
        if (leftOfAgeAnsweredCount > 0 && leftOfAgeFailCount === 0) {
            return "normal";
        }

        return "unknown";
    }

    function renderInterpretations(screening, masterTasks) {
        const container = byId("resultDomainInterpretation");
        if (!container) return {};
        container.innerHTML = "";
        const domainStatuses = {};

        const ageMonths = getAgeMonths(screening.age);
        const validMasterTasks = (Array.isArray(masterTasks) ? masterTasks : [])
            .filter(task => task && typeof task === "object");

        const taskMap = new Map();
        const taskNameMap = new Map();

        validMasterTasks.forEach(task => {
            const id = getTaskId(task);
            if (id !== undefined && id !== null) {
                taskMap.set(String(id), task);
            }

            const nameKey = normalizeTaskKey(getTaskName(task));
            if (nameKey && !taskNameMap.has(nameKey)) {
                taskNameMap.set(nameKey, task);
            }
        });

        DOMAIN_ORDER.forEach(([key, fallbackName, icon]) => {
            const domain = screening.domains?.[key] || {};
            const status = interpretDomain(domain, ageMonths, taskMap, taskNameMap);
            domainStatuses[key] = status;
            const info = STATUS_INFO[status];

            const card = document.createElement("article");
            card.className = "domain-interpretation-item";

            const title = document.createElement("h3");
            title.className = "domain-interpretation-name";
            title.textContent = `${icon} ${domain.name || fallbackName}`;

            const badge = document.createElement("span");
            badge.className = `domain-interpretation-status ${info.className}`;
            badge.textContent = info.label;

            card.append(title, badge);
            container.appendChild(card);
        });
        return domainStatuses;
    }

    function renderAiResult(data) {
        currentAiResult = data;
        const status = String(data.status || "").toLowerCase();
        if (status !== "normal" && status !== "suspect") {
            throw new Error("Model memberikan status yang tidak dikenali.");
        }
        const statusCard = byId("finalStatusCard");
        statusCard?.classList.toggle("final-status-suspect", status === "suspect");
        statusCard?.classList.toggle("final-status-normal", status === "normal");
        safeText("aiFinalStatus", data.status_label || status.toUpperCase());
        safeText("aiFinalDescription", data.description || "Hasil analisis selesai.");
        
        const probabilities = data.probabilities || {};

        const formatProbability = value => {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                return "—";
            }

            return `${(value * 100).toLocaleString("id-ID", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}%`;
        };

        safeText(
            "normalProbability",
            formatProbability(probabilities.normal)
        );

        safeText(
            "suspectProbability",
            formatProbability(probabilities.suspect)
        );

        safeText("aiRecommendation", data.recommendation || "Lanjutkan stimulasi sesuai usia dan lakukan pemantauan perkembangan anak secara berkala.");
        byId("aiStartPanel").hidden = true;
        byId("aiLoadingPanel").hidden = true;
        byId("aiErrorPanel").hidden = true;
        byId("aiResultPanel").hidden = false;
    }

    async function setupAiAnalysis(domainStatuses) {
        const startPanel = byId("aiStartPanel");
        const loadingPanel = byId("aiLoadingPanel");
        const errorPanel = byId("aiErrorPanel");
        const resultPanel = byId("aiResultPanel");
        const analyzeButton = byId("aiAnalyzeButton");
        const retryButton = byId("aiRetryButton");
        const prerequisiteNote = byId("aiPrerequisiteNote");

        if (!startPanel || !loadingPanel || !errorPanel || !resultPanel || !analyzeButton) return;

        const saveReportButton = byId("saveReportButton");
        if (saveReportButton && !saveReportButton.dataset.reportHandlerAttached) {
            saveReportButton.dataset.reportHandlerAttached = "true";
            saveReportButton.addEventListener("click", async () => {
                if (!currentAiResult) {
                    alert("Jalankan analisis AI terlebih dahulu sebelum menyimpan laporan.");
                    return;
                }
                saveReportButton.disabled = true;
                const originalLabel = saveReportButton.textContent;
                saveReportButton.textContent = "Menyiapkan laporan…";
                try {
                    const response = await fetch("/api/denver/report-pdf", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ domain_statuses: domainStatuses }),
                        cache: "no-store"
                    });
                    if (!response.ok) {
                        let message = "Laporan gagal dibuat.";
                        try {
                            const errorData = await response.json();
                            message = errorData.message || message;
                        } catch (_) { /* respons bukan JSON */ }
                        throw new Error(message);
                    }
                    const blob = await response.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = objectUrl;
                    link.download = "laporan_denver_ii.pdf";
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    URL.revokeObjectURL(objectUrl);
                } catch (error) {
                    console.error("Gagal mengunduh laporan Denver II:", error);
                    alert(error.message || "Laporan gagal dibuat. Silakan coba lagi.");
                } finally {
                    saveReportButton.disabled = false;
                    saveReportButton.textContent = originalLabel;
                }
            });
        }

        const requiredKeys = ["personal_social", "fine_motor_adaptive", "language", "gross_motor"];
        const validStatuses = new Set(["advanced", "normal", "caution", "delayed"]);
        const unresolved = requiredKeys.some(key => !validStatuses.has(domainStatuses?.[key]));
        if (unresolved) {
            analyzeButton.disabled = true;
            prerequisiteNote.textContent = "Analisis belum dapat dimulai karena minimal satu domain belum memiliki interpretasi yang dapat digunakan oleh model. Periksa data dan hasil domain terlebih dahulu.";
            prerequisiteNote.classList.add("ai-prerequisite-warning");
            return;
        }

        let isAnalyzing = false;
        const setMinimumLoadingTime = async startedAt => {
            const remaining = 3000 - (Date.now() - startedAt);
            if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        };

        // Muat hasil tersimpan terlebih dahulu. Jika input masih sama, jangan panggil model ulang.
        // Nonaktifkan tombol sementara agar pengguna tidak memulai request bersamaan.
        analyzeButton.disabled = true;
        try {
            const cachedResponse = await fetch("/api/ai/cached-result", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domain_statuses: domainStatuses }),
                cache: "no-store"
            });
            const cachedData = await cachedResponse.json();
            if (cachedResponse.ok && cachedData.success && cachedData.cached && cachedData.result) {
                renderAiResult(cachedData.result);
                return;
            }
            analyzeButton.disabled = false;
        } catch (error) {
            // Cache tidak tersedia bukan alasan untuk menghentikan analisis baru.
            console.warn("Tidak dapat memeriksa cache AI; analisis tetap dapat dimulai.", error);
            analyzeButton.disabled = false;
        }

        const runAnalysis = async () => {
            if (isAnalyzing) return;
            isAnalyzing = true;
            analyzeButton.disabled = true;
            if (retryButton) retryButton.disabled = true;
            startPanel.hidden = true;
            errorPanel.hidden = true;
            resultPanel.hidden = true;
            loadingPanel.hidden = false;

            const analysisStartedAt = Date.now();
            try {
                const response = await fetch("/api/ai/analyze", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ domain_statuses: domainStatuses }),
                    cache: "no-store"
                });
                const data = await response.json();
                await setMinimumLoadingTime(analysisStartedAt);
                if (!response.ok || !data.success) {
                    throw new Error(data.message || "Analisis AI gagal dijalankan.");
                }
                renderAiResult(data);
            } catch (error) {
                await setMinimumLoadingTime(analysisStartedAt);
                console.error("Analisis AI gagal:", error);
                loadingPanel.hidden = true;
                errorPanel.hidden = false;
                safeText("aiErrorMessage", error.message || "Analisis gagal. Silakan coba kembali.");
                startPanel.hidden = true;
            } finally {
                isAnalyzing = false;
                analyzeButton.disabled = false;
                if (retryButton) retryButton.disabled = false;
            }
        };

        startPanel.hidden = false;
        analyzeButton.addEventListener("click", runAnalysis);
        retryButton?.addEventListener("click", () => {
            errorPanel.hidden = true;
            runAnalysis();
        });
    }

    try {
        const [screeningResponse, masterResponse] = await Promise.all([
            fetch("/api/screening/current", { cache: "no-store" }),
            fetch("/api/denver/diagram-data", { cache: "no-store" })
        ]);

        const result = await screeningResponse.json();
        if (!screeningResponse.ok || !result.success || !result.saved || !result.screening) {
            const summary = byId("resultDomainSummary");
            if (summary) summary.innerHTML = '<p class="result-error">Belum ada hasil pemeriksaan yang tersimpan. Kembali ke halaman utama dan simpan pemeriksaan terlebih dahulu.</p>';
            const interpretation = byId("resultDomainInterpretation");
            if (interpretation) interpretation.innerHTML = '<p class="result-error">Interpretasi belum tersedia karena hasil pemeriksaan belum tersimpan.</p>';
            return;
        }

        renderChild(result.screening);
        renderSummary(result.screening);

        if (!masterResponse.ok) {
            throw new Error("Master tugas Denver II gagal dimuat.");
        }
        const masterResult = await masterResponse.json();
        if (!masterResult.success || !Array.isArray(masterResult.tasks)) {
            throw new Error("Data persentil tugas Denver II tidak valid.");
        }
        await renderDiagramPreview(result.screening, masterResult.tasks);
        const domainStatuses = renderInterpretations(result.screening, masterResult.tasks);
        setupAiAnalysis(domainStatuses);
    } catch (error) {
        console.error("Gagal memuat hasil pemeriksaan:", error);
        const summary = byId("resultDomainSummary");
        if (summary) summary.innerHTML = '<p class="result-error">Hasil pemeriksaan gagal dimuat. Periksa koneksi aplikasi lalu coba kembali.</p>';
        const interpretation = byId("resultDomainInterpretation");
        if (interpretation) interpretation.innerHTML = '<p class="result-error">Interpretasi gagal dihitung karena data persentil Denver II tidak dapat dimuat.</p>';
    }
});
