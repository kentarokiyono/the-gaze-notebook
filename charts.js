/* ============================================================================
 * The Gaze — Charts (Phase 15)
 * データ(CSV)からチャート生成（棒/折れ線/円/ドーナツ/レーダー）。Chart.js 使用。
 * ブロックには {type, title, csv} を保持し、描画時に CSV を解析する。
 * ========================================================================== */
(function () {
  'use strict';
  const PALETTE = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

  function parseCSV(csv) {
    const lines = String(csv || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return { labels: [], series: [] };
    const split = (l) => l.split(',').map((c) => c.trim());
    const header = split(lines[0]);
    const seriesNames = header.slice(1);
    const labels = [];
    const cols = seriesNames.map(() => []);
    for (let i = 1; i < lines.length; i++) {
      const cells = split(lines[i]);
      labels.push(cells[0] || '');
      for (let j = 0; j < seriesNames.length; j++) { const v = parseFloat(cells[j + 1]); cols[j].push(isNaN(v) ? 0 : v); }
    }
    return { labels, series: seriesNames.map((name, j) => ({ name, data: cols[j] })), xLabel: header[0] || '' };
  }

  function render(canvas, spec) {
    if (!window.Chart) { const p = canvas.parentNode; if (p) { const d = document.createElement('div'); d.className = 'chart-err'; d.textContent = 'チャートライブラリを読み込めませんでした（オフライン初回など）'; p.appendChild(d); } return; }
    if (canvas.__chart) { try { canvas.__chart.destroy(); } catch (e) {} }
    const spec2 = spec || {};
    const { labels, series } = parseCSV(spec2.csv);
    const type = spec2.type || 'bar';
    const pie = type === 'pie' || type === 'doughnut';
    let datasets;
    if (pie) {
      datasets = [{ data: (series[0] ? series[0].data : []), backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: '#141416', borderWidth: 2 }];
    } else {
      datasets = series.map((s, i) => ({
        label: s.name, data: s.data,
        backgroundColor: type === 'line' ? PALETTE[i % PALETTE.length] + '33' : PALETTE[i % PALETTE.length],
        borderColor: PALETTE[i % PALETTE.length], borderWidth: 2, tension: 0.3, fill: type === 'line' ? false : undefined,
        pointRadius: type === 'line' ? 3 : undefined,
      }));
    }
    const grid = 'rgba(148,163,184,0.12)', tick = '#94a3b8';
    const opts = {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: pie || series.length > 1, labels: { color: tick, font: { size: 11 } } },
        title: spec2.title ? { display: true, text: spec2.title, color: '#e2e8f0', font: { size: 14, weight: '600' } } : { display: false },
      },
      scales: pie ? {} : {
        x: { grid: { color: grid }, ticks: { color: tick, font: { size: 11 } } },
        y: { grid: { color: grid }, ticks: { color: tick, font: { size: 11 } }, beginAtZero: true },
      },
    };
    try { canvas.__chart = new Chart(canvas.getContext('2d'), { type, data: { labels, datasets }, options: opts }); }
    catch (e) { const p = canvas.parentNode; if (p) { const d = document.createElement('div'); d.className = 'chart-err'; d.textContent = 'チャートを描画できません'; p.appendChild(d); } }
  }

  function defaultSpec() { return { type: 'bar', title: '', csv: '月,売上\n1月,120\n2月,150\n3月,90\n4月,170' }; }

  window.GazeChart = { render, parseCSV, defaultSpec };
})();
