(() => {
    "use strict";

    const DOMAIN_ORDER = [
        ["personal_social", "Personal Sosial", "#39a96b", "👥"],
        ["fine_motor_adaptive", "Adaptif-Motorik Halus", "#4f8ee8", "✋"],
        ["language", "Bahasa", "#f39a21", "💬"],
        ["gross_motor", "Motorik Kasar", "#8a65d6", "🏃"]
    ];
    // Tugas usia sangat awal yang labelnya ditempatkan di sebelah kanan kotak.
    const LABEL_OUTSIDE_TASK_IDS = new Set(["PS_001", "L_001", "L_002", "GM_001", "GM_002"]);
    const FULL_GREEN_TASK_IDS = new Set(["PS_001", "L_001", "L_002", "GM_001", "GM_002"]);

    const SVG_NS = "http://www.w3.org/2000/svg";
    const BASE_WIDTH = 2600;
    const LEFT = 255
    const RIGHT = 34;
    const TOP = 100;
    // Skala Denver II: 1 interval per bulan sampai 24 bulan,
    // lalu 1 interval per 3 bulan sampai 72 bulan (6 tahun).
    const AXIS_INTERVALS = 24 + (72 - 24) / 3;
    const SCALE = (BASE_WIDTH - LEFT - RIGHT) / AXIS_INTERVALS;

    function ageToAxisUnits(month) {
        const value = Math.max(0, Math.min(72, Number(month) || 0));
        return value <= 24 ? value : 24 + (value - 24) / 3;
    }

    function xForMonth(month) {
        return LEFT + ageToAxisUnits(month) * SCALE;
    }
    const LANE_HEIGHT = 38; // Jarak vertikal antar tugas
    const DOMAIN_GAP = 30;

    const chart = document.getElementById("denverChart");
    const viewport = document.getElementById("chartViewport");
    const status = document.getElementById("chartStatus");
    const noChildNotice = document.getElementById("noChildNotice");
    let zoom = 1;
    let tasks = [];
    let initialTaskIds = new Set();
    let ageMonths = null;
    let screeningData = null;
    const answerByTaskId = new Map();

    function readSession(key) {
        try { return JSON.parse(sessionStorage.getItem(key) || "null"); }
        catch (_) { return null; }
    }
    function escapeText(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        }[char]));
    }
    function monthText(value) {
        if (value === null || value === undefined || value === "") return "Tidak tersedia";
        const n = Number(value);
        const years = Math.floor(n / 12);
        const months = n - years * 12;
        if (years) return `${years} th ${Number(months.toFixed(1))} bln`;
        return `${Number(n.toFixed(2))} bln`;
    }
    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    }
    function showMetadata(screening) {
        const child = screening?.child || {};
        const age = screening?.age || {};
        const hasSavedChild = Boolean(screening && child.birth_date && screening.age);
        document.getElementById("examinerName").textContent = child.examiner_name || "—";
        document.getElementById("screeningDate").textContent = formatDate(child.screening_date);
        document.getElementById("childName").textContent = child.child_name || "—";
        document.getElementById("birthDate").textContent = formatDate(child.birth_date);
        document.getElementById("childAge").textContent = hasSavedChild
            ? `${age.years} Tahun ${age.months} Bulan ${age.days} Hari`
            : "—";
        const state = document.getElementById("metadataState");
        state.textContent = hasSavedChild ? "Data pemeriksaan tersimpan" : "Data pemeriksaan belum tersedia";
        state.classList.toggle("is-saved", hasSavedChild);
        noChildNotice.hidden = hasSavedChild;
        ageMonths = hasSavedChild ? Number(age.years) * 12 + Number(age.months) + Number(age.days) / 30 : null;
    }
    function getPercentile(task, key) {
        const value = task[key];
        return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
            ? null : Number(value);
    }
    function taskStart(task) {
        for (const key of ["p25_month", "p50_month", "p75_month", "p90_month"]) {
            const value = getPercentile(task, key);
            if (value !== null) return value;
        }
        return 0;
    }
    function svgEl(name, attrs = {}, text = null) {
        const node = document.createElementNS(SVG_NS, name);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
        if (text !== null) node.textContent = text;
        return node;
    }
    function textWidthApprox(text, fontSize = 10) {
        return Math.max(20, String(text).length * fontSize * 0.56);
    }
    function wrapText(text, maxChars, maxLines = 2) {
        const words = String(text || "").split(/\s+/);
        const lines = [];
        let line = "";
        words.forEach(word => {
            const next = line ? `${line} ${word}` : word;
            if (next.length > maxChars && line) {
                lines.push(line);
                line = word;
            } else line = next;
        });
        if (line) lines.push(line);
        if (lines.length > maxLines) {
            const kept = lines.slice(0, maxLines);
            kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:]?$/, "…");
            return kept;
        }
        return lines;
    }
    function allocateLanes(domainTasks) {
        // Urutan vertikal mengikuti ID: ID terbesar di atas, ID terkecil di bawah.
        // Setiap tugas mendapat baris sendiri agar label tidak bertumpuk.
        const sorted = [...domainTasks].sort((a, b) => {
            const getIdNumber = task => {
                const match = String(task.id || "").match(/(\\d+)$/);
                return match ? Number(match[1]) : 0;
            };
            return getIdNumber(a) - getIdNumber(b) ||
                String(a.id || "").localeCompare(String(b.id || ""));
        });

        sorted.forEach((task, index) => {
            task._lane = sorted.length - 1 - index;
        });

        return { tasks: sorted, laneCount: Math.max(1, sorted.length) };
    }
    function drawAxis(svg, totalHeight) {
        const axisY = TOP - 10;
        const axisEndX = BASE_WIDTH - RIGHT;
        svg.appendChild(svgEl("line", {
            x1: LEFT, y1: axisY, x2: axisEndX, y2: axisY,
            stroke: "#7c8797", "stroke-width": 1.2
        }));

        const monthLabels = new Map([
            [2, "2"], [4, "4"], [6, "6"], [9, "9"], [12, "12"],
            [15, "15"], [18, "18"], [24, "24"]
        ]);
        const yearLabels = new Map([[36, "3"], [48, "4"], [60, "5"], [72, "6"]]);
        const ticks = [];
        for (let month = 1; month <= 24; month += 1) ticks.push(month);
        for (let month = 27; month <= 72; month += 3) ticks.push(month);

        svg.appendChild(svgEl("text", {
            x: LEFT, y: 45, fill: "#536071", "font-size": 12, "font-weight": 700
        }, "BULAN"));
        svg.appendChild(svgEl("text", {
            x: xForMonth(36), y: 45, fill: "#536071", "font-size": 12, "font-weight": 700
        }, "TAHUN"));

        ticks.forEach(month => {
            const x = xForMonth(month);
            svg.appendChild(svgEl("line", {
                x1: x, y1: axisY - 4, x2: x, y2: axisY + 4,
                stroke: "#697586", "stroke-width": 1
            }));
            // Garis kisi vertikal hanya pada penanda bernomor utama.
            if (monthLabels.has(month) || yearLabels.has(month)) {
                svg.appendChild(svgEl("line", {
                    x1: x, y1: axisY + 5, x2: x, y2: totalHeight - 27,
                    stroke: "#e5e9ef", "stroke-width": 1
                }));
            }
            const label = monthLabels.get(month) || yearLabels.get(month);
            if (label) {
                svg.appendChild(svgEl("text", {
                    x, y: axisY - 9, fill: "#3e4856", "font-size": 11,
                    "text-anchor": "middle"
                }, label));
            }
        });
    }

    function drawBottomAxis(svg, totalHeight) {
        const axisY = totalHeight - 35;
        const axisEndX = BASE_WIDTH - RIGHT;
        svg.appendChild(svgEl("line", {
            x1: LEFT, y1: axisY, x2: axisEndX, y2: axisY,
            stroke: "#7c8797", "stroke-width": 1.2
        }));

        const monthLabels = new Map([
            [2, "2"], [4, "4"], [6, "6"], [9, "9"], [12, "12"],
            [15, "15"], [18, "18"], [24, "24"]
        ]);
        const yearLabels = new Map([[36, "3"], [48, "4"], [60, "5"], [72, "6"]]);
        const ticks = [];
        for (let month = 1; month <= 24; month += 1) ticks.push(month);
        for (let month = 27; month <= 72; month += 3) ticks.push(month);

        ticks.forEach(month => {
            const x = xForMonth(month);
            svg.appendChild(svgEl("line", {
                x1: x, y1: axisY - 4, x2: x, y2: axisY + 4,
                stroke: "#697586", "stroke-width": 1
            }));
            const label = monthLabels.get(month) || yearLabels.get(month);
            if (label) {
                svg.appendChild(svgEl("text", {
                    x, y: axisY + 16, fill: "#3e4856", "font-size": 11,
                    "text-anchor": "middle"
                }, label));
            }
        });
        svg.appendChild(svgEl("text", {
            x: LEFT, y: totalHeight - 3, fill: "#536071",
            "font-size": 12, "font-weight": 700
        }, "BULAN"));
        svg.appendChild(svgEl("text", {
            x: xForMonth(36), y: totalHeight - 3, fill: "#536071",
            "font-size": 12, "font-weight": 700
        }, "TAHUN"));
    }

    function addPattern(svg) {
        const defs = svgEl("defs");
        const pattern = svgEl("pattern", { id: "percentileHatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" });
        pattern.appendChild(svgEl("rect", { width: 6, height: 6, fill: "#dff1e2" }));
        pattern.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#78bd85", "stroke-width": 2 }));
        defs.appendChild(pattern);
        svg.appendChild(defs);
    }
    function drawTask(svg, task, y) {
        const start = taskStart(task);
        const p50 = getPercentile(task, "p50_month");
        const p75 = getPercentile(task, "p75_month");
        const p90 = getPercentile(task, "p90_month") ?? start;
        const xStart = xForMonth(start);
        const xEnd = xForMonth(p90);
        const x75 = p75 === null ? xEnd : xForMonth(p75);
        const x50 = p50 === null ? null : xForMonth(p50);
        const isInitial = initialTaskIds.has(String(task.id));
        const answer = answerByTaskId.get(String(task.id)) || null;
        const isAdditionalChecked = Boolean(answer && !isInitial);
        const labelOutside = LABEL_OUTSIDE_TASK_IDS.has(task.id);
        const fullGreen = FULL_GREEN_TASK_IDS.has(task.id);
        const isFollowMidlineTask = /mengikuti\s+lewat\s+garis\s+tengah/i.test(task.name || "");
        const group = svgEl("g", {
            class: `task-bar${isInitial ? " initial-task" : ""}${isAdditionalChecked ? " additional-task" : ""}${answer ? " answered-task" : ""}`, tabindex: 0, role: "button",
            "data-task-id": task.id,
            "aria-label": `${task.name}${task.reportable ? ", reportable" : ""}`
        });
        group.appendChild(svgEl("title", {}, `${task.name}${task.reportable ? " (L — reportable)" : ""}${answer ? `\nHasil pemeriksaan: ${answer === "P" ? "Berhasil (P)" : "Gagal (F)"}` : "\nBelum diperiksa"}\nJenis: ${isInitial ? "Tugas awal" : (isAdditionalChecked ? "Tugas tambahan" : "Tugas acuan")}\nP25: ${monthText(getPercentile(task, "p25_month"))}; P50: ${monthText(p50)}; P75: ${monthText(p75)}; P90: ${monthText(p90)}`));

        // Persentil yang tersedia digambar apa adanya; nilai yang kosong tidak diestimasi.
        const labelEnd = Math.max(xStart + 24, Math.min(x75, xEnd));
        group.appendChild(svgEl("rect", {
            x: xStart, y: y, width: Math.max(1, labelEnd - xStart), height: 36,
            fill: isAdditionalChecked ? "#fffaf6" : (fullGreen ? "#ccebd2" : (isInitial ? "#eaf1ff" : "#ffffff")),
            stroke: isInitial ? "#3475ee" : (isAdditionalChecked ? "#ff873e" : "#7cbd88"),
            "stroke-width": isInitial || isAdditionalChecked ? 2.2 : 1.1,
            class: "task-outline"
        }));
        if (!fullGreen && p75 !== null && p90 > p75) {
            group.appendChild(svgEl("rect", {
                x: xForMonth(p75),
                y,
                width: Math.max(1, xForMonth(p90) - xForMonth(p75)),
                height: 36,
                fill: "#ccebd2",
                stroke: isInitial ? "#3475ee" : (isAdditionalChecked ? "#ff873e" : "#8cc797"),
                "stroke-width": isInitial || isAdditionalChecked ? 1.7 : 0.8,
                class: "task-percentile-range"
            }));
        } else if (!fullGreen && p75 === null && p90 > start) {
            // Tidak ada P75: rentang yang diketahui ditampilkan polos, tanpa mengklaim arsiran P75–P90.
            group.appendChild(svgEl("rect", {
                x: xStart, y, width: Math.max(1, xEnd - xStart), height: 36,
                fill: isInitial ? "#eaf1ff" : (isAdditionalChecked ? "#fffaf6" : "#ffffff"),
                stroke: isInitial ? "#3475ee" : (isAdditionalChecked ? "#ff873e" : "#7cbd88"),
                "stroke-width": isInitial || isAdditionalChecked ? 2 : 1
            }));
        }
        if (x50 !== null) {
            group.appendChild(svgEl("line", { x1: x50, y1: y + 2, x2: x50, y2: y + 9, stroke: "#222", "stroke-width": 1.2 }));
        }

        // Label tugas khusus diletakkan di luar kotak; tugas lain tetap di dalam kotak.
        const textAreaEnd = isFollowMidlineTask ? xEnd : labelEnd;
        const usableWidth = Math.max(0, textAreaEnd - xStart - 10);
        const maxChars = labelOutside
            ? 24
            : (isFollowMidlineTask
                ? Math.max(14, Math.floor(usableWidth / 5.9))
                : Math.max(5, Math.floor(usableWidth / 5.9)));
        let lines;
        if (isFollowMidlineTask) {
            // Hindari elipsis untuk tugas ini dan pertahankan pemenggalan yang diminta.
            lines = ["Mengikuti Lewat", "Garis Tengah"];
        } else if (labelOutside) {
            lines = wrapText(task.name, maxChars, 3);
        } else {
            lines = wrapText(task.name, maxChars, 3);
        }

        const fontSize = 10.5;
        const textX = labelOutside ? labelEnd + 6 : xStart + 5;
        const textY = lines.length === 1 ? y + 22 : (lines.length === 2 ? y + 15 : y + 11);
        const label = svgEl("text", {
            x: textX, y: textY, fill: "#263b2b",
            "font-size": fontSize, "font-weight": 600,
            "pointer-events": "none"
        });
        lines.forEach((line, i) => label.appendChild(svgEl("tspan", {
            x: textX, dy: i === 0 ? 0 : 11
        }, line)));
        group.appendChild(label);

        if (task.reportable) {
            const lx = Math.min(BASE_WIDTH - 22, Math.max(xStart + 2, labelEnd - 15));
            group.appendChild(svgEl("rect", { x: lx, y: y + 3, width: 12, height: 12, rx: 2, fill: "#fff0df", stroke: "#ed9b4c", "stroke-width": .7 }));
            group.appendChild(svgEl("text", { x: lx + 6, y: y + 12, "text-anchor": "middle", fill: "#a9580e", "font-size": 8, "font-weight": 800, "pointer-events": "none" }, "L"));
        }
        if (answer) {
            const badgeX = Math.max(208, xStart - 34);
            const isPass = answer === "P";
            group.appendChild(svgEl("rect", {
                x: badgeX, y: y + 5, width: 25, height: 24, rx: 6,
                fill: isPass ? "#dcfce7" : "#fee2e2",
                stroke: isPass ? "#86d49b" : "#fca5a5", "stroke-width": 1
            }));
            group.appendChild(svgEl("text", {
                x: badgeX + 12.5, y: y + 21, "text-anchor": "middle",
                fill: isPass ? "#166534" : "#b91c1c",
                "font-size": 12, "font-weight": 900, "pointer-events": "none"
            }, answer));
        }
        svg.appendChild(group);
    }
    function renderChart() {
        chart.innerHTML = "";
        const domainLayouts = DOMAIN_ORDER.map(([key, name, color, icon]) => {
            const domainTasks = tasks.filter(task => task.domain === key);
            return { key, name, color, icon, ...allocateLanes(domainTasks) };
        });
        let y = TOP;
        domainLayouts.forEach(domain => {
            domain.y = y;
            domain.height = domain.laneCount * LANE_HEIGHT + 26;
            y += domain.height + DOMAIN_GAP;
        });
        const totalHeight = y + 45;
        chart.setAttribute("viewBox", `0 0 ${BASE_WIDTH} ${totalHeight}`);
        chart.setAttribute("width", BASE_WIDTH);
        chart.setAttribute("height", totalHeight);
        drawAxis(chart, totalHeight);

        domainLayouts.forEach(domain => {
            chart.appendChild(svgEl("rect", {
                x: 0, y: domain.y - 8, width: BASE_WIDTH, height: domain.height + 8,
                fill: domainLayouts.indexOf(domain) % 2 ? "#fbfcfe" : "#ffffff",
                stroke: "#e1e7ef", "stroke-width": 1
            }));
            const DOMAIN_COLUMN_WIDTH = 205;

            chart.appendChild(svgEl("rect", {
                x: 0,
                y: domain.y - 8,
                width: DOMAIN_COLUMN_WIDTH,
                height: domain.height + 8,
                fill: "#f4f7fb"
            }));
            const domainLabel = svgEl("text", {
                x: 16,
                y: domain.y + 9,
                fill: domain.color,
                "font-size": 12,
                "font-weight": 800
            });

            const domainName = domain.name.toUpperCase();
            const maxDomainChars = 25;

            domainLabel.textContent = domainName.length > maxDomainChars
                ? domainName.slice(0, maxDomainChars - 3) + "..."
                : domainName;

            chart.appendChild(domainLabel);
            domain.tasks.forEach(task => drawTask(chart, task, domain.y + task._lane * LANE_HEIGHT + 3));
        });

        if (ageMonths !== null && Number.isFinite(ageMonths)) {
            const ageX = xForMonth(ageMonths);
            chart.appendChild(svgEl("line", {
                x1: ageX, y1: 32, x2: ageX, y2: totalHeight - 12,
                stroke: "#3475ee", "stroke-width": 2, "stroke-dasharray": "7 5"
            }));
            const screeningDate = screeningData?.child?.screening_date || "";

            const dateParts = screeningDate.split("-");
            const dateLabel = dateParts.length === 3
                ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
                : "Tanggal tidak tersedia";

            const labelWidth = 105;
            const labelX = Math.max(
                LEFT,
                Math.min(BASE_WIDTH - RIGHT - labelWidth, ageX - labelWidth / 2)
            );

            chart.appendChild(svgEl("rect", {
                x: labelX,
                y: 3,
                width: labelWidth,
                height: 27,
                rx: 5,
                fill: "#3475ee"
            }));

            chart.appendChild(svgEl("text", {
                x: labelX + labelWidth / 2,
                y: 21,
                fill: "#fff",
                "font-size": 11,
                "font-weight": 700,
                "text-anchor": "middle"
            }, dateLabel));
            status.textContent = "Garis biru menunjukkan usia anak. Kotak biru menandai tugas awal; kotak jingga menandai tugas tambahan yang diperiksa.";
        } else {
            status.textContent = "Diagram ditampilkan tanpa garis umur dan tanpa penanda tugas awal karena data anak belum disimpan.";
        }
        status.textContent += " Tanda 'L' menunjukkan bahwa tugas dapat diselesaikan berdasar laporan orang tua. Garis tegak kecil menunjukkan P50. Warna hijau menunjukkan rentang P75-P90.";
        drawBottomAxis(chart, totalHeight);
    }
    function showTaskDetails(task) {
        document.getElementById("selectedTaskName").textContent = task.name;

        const domain = DOMAIN_ORDER.find(item => item[0] === task.domain);

        const answer = answerByTaskId.get(String(task.id));
        const taskType = initialTaskIds.has(String(task.id)) ? "Tugas awal" : (answer ? "Tugas tambahan yang diperiksa" : "Tugas acuan");
        const answerText = answer ? ` • Hasil pemeriksaan: ${answer === "P" ? "Berhasil (P)" : "Gagal (F)"}` : " • Belum diperiksa";
        document.getElementById("selectedTaskDomain").textContent =
            `${domain ? domain[1] : task.domain} • ${taskType}${answerText}${task.reportable ? " • Item laporan (L)" : ""}`;

        const details = document.getElementById("selectedTaskDetails");
        details.innerHTML = "";
        if (answer) {
            const answerChip = document.createElement("span");
            answerChip.className = `detail-chip ${answer === "P" ? "answer-chip-pass" : "answer-chip-fail"}`;
            answerChip.textContent = `Hasil: ${answer === "P" ? "Berhasil (P)" : "Gagal (F)"}`;
            details.appendChild(answerChip);
        }

        // BARIS PERTAMA: informasi persentil
        [
            ["P25", task.p25_month],
            ["P50", task.p50_month],
            ["P75", task.p75_month],
            ["P90", task.p90_month]
        ].forEach(([label, value]) => {
            const chip = document.createElement("span");
            chip.className = "detail-chip";
            chip.textContent = `${label}: ${monthText(value)}`;
            details.appendChild(chip);
        });

        // BARIS KEDUA: detail tugas saja
        if (task.footnote) {
            const detailRow = document.createElement("div");
            detailRow.className = "task-footnote";
            detailRow.textContent = `Detail Tugas: ${task.footnote}`;
            details.appendChild(detailRow);
        }
    }

    function setupInteractions() {
        chart.addEventListener("click", event => {
            const group = event.target.closest("[data-task-id]");
            if (!group) return;
            const task = tasks.find(item => item.id === group.dataset.taskId);
            if (task) showTaskDetails(task);
        });
        chart.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const group = event.target.closest("[data-task-id]");
            if (!group) return;
            event.preventDefault();
            const task = tasks.find(item => item.id === group.dataset.taskId);
            if (task) showTaskDetails(task);
        });

        document.getElementById("zoomIn").addEventListener("click", () => setZoom(Math.min(2.4, zoom + 0.2)));
        document.getElementById("zoomOut").addEventListener("click", () => setZoom(Math.max(0.6, zoom - 0.2)));
        document.getElementById("zoomReset").addEventListener("click", () => setZoom(1));
        document.getElementById("printPdfButton").addEventListener("click", printDiagramPdf);

        let drag = null;
        viewport.addEventListener("pointerdown", event => {
            if (event.button !== 0 || event.target.closest("[data-task-id]")) return;
            drag = { x: event.clientX, left: viewport.scrollLeft };
            viewport.classList.add("is-dragging");
            viewport.setPointerCapture(event.pointerId);
        });
        viewport.addEventListener("pointermove", event => {
            if (!drag) return;
            viewport.scrollLeft = drag.left - (event.clientX - drag.x);
        });
        const stopDrag = () => { drag = null; viewport.classList.remove("is-dragging"); };
        viewport.addEventListener("pointerup", stopDrag);
        viewport.addEventListener("pointercancel", stopDrag);
    }

    async function printDiagramPdf() {
        const button = document.getElementById("printPdfButton");
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Menyiapkan PDF…";
        try {
            const response = await fetch("/api/denver/detail-diagram-pdf", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
                cache: "no-store"
            });
            if (!response.ok) {
                let message = "PDF detail diagram gagal dibuat.";
                try { const errorData = await response.json(); message = errorData.message || message; } catch (_) {}
                throw new Error(message);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "detail_diagram_pemeriksaan_denver_ii.pdf";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error(error);
            alert(error.message || "PDF gagal dibuat. Pastikan server Flask berjalan dan WeasyPrint sudah terpasang.");
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    function setZoom(value) {
        zoom = value;
        chart.style.width = `${BASE_WIDTH * zoom}px`;
        document.getElementById("zoomReset").textContent = `${Math.round(zoom * 100)}%`;
    }
    async function init() {
        try {
            status.textContent = "Memuat data pemeriksaan dan diagram Denver II…";
            const [screeningResponse, masterResponse] = await Promise.all([
                fetch("/api/screening/current", { cache: "no-store" }),
                fetch("/api/denver/diagram-data", { cache: "no-store" })
            ]);
            const screeningResult = await screeningResponse.json();
            const masterResult = await masterResponse.json();

            if (!screeningResponse.ok || !screeningResult.success || !screeningResult.saved || !screeningResult.screening) {
                throw new Error("Belum ada hasil pemeriksaan tersimpan. Kembali ke halaman utama dan selesaikan pemeriksaan terlebih dahulu.");
            }
            if (!masterResponse.ok || !masterResult.success || !Array.isArray(masterResult.tasks)) {
                throw new Error("Master tugas Denver II gagal dimuat.");
            }

            screeningData = screeningResult.screening;
            showMetadata(screeningData);
            Object.values(screeningData.domains || {}).forEach(domainState => {
                (Array.isArray(domainState.tasks) ? domainState.tasks : []).forEach(task => {
                    const id = String(task.id ?? task.task_id ?? "");
                    const answer = String(task.answer || "").trim().toUpperCase();
                    if (id && (answer === "P" || answer === "F")) answerByTaskId.set(id, answer);
                });
            });

            const age = screeningData.age;
            if (age && [age.years, age.months, age.days].every(value => value !== undefined && value !== null && Number.isFinite(Number(value)))) {
                const initialResponse = await fetch("/api/denver/initial-tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ age }),
                    cache: "no-store"
                });
                const initialResult = await initialResponse.json();
                if (initialResponse.ok && initialResult.success && initialResult.tasks) {
                    Object.values(initialResult.tasks).flat().forEach(task => initialTaskIds.add(String(task.id ?? task.task_id ?? "")));
                }
            }

            tasks = masterResult.tasks;
            renderChart();
            setupInteractions();
            setZoom(1);
            const passCount = [...answerByTaskId.values()].filter(answer => answer === "P").length;
            const failCount = [...answerByTaskId.values()].filter(answer => answer === "F").length;
            status.textContent = `Diagram lengkap memuat ${tasks.length} tugas acuan. Pemeriksaan tersimpan: ${answerByTaskId.size} tugas (${passCount} berhasil/P, ${failCount} gagal/F). Tugas awal berbingkai biru dan tugas tambahan yang diperiksa berbingkai jingga.`;
        } catch (error) {
            console.error(error);
            status.textContent = error.message || "Diagram gagal dimuat. Pastikan data pemeriksaan tersimpan dan server Flask berjalan.";
            noChildNotice.hidden = false;
        }
    }
    init();
})();
