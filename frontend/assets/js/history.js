class HistoryManager {
  constructor() {
    this.limit = 20;
    this.offset = 0;
    this.total = 0;

    this.el = {
      loading: document.getElementById('loadingScreen'),
      body: document.getElementById('historyBody'),
      empty: document.getElementById('emptyState'),

      totalCount: document.getElementById('totalCount'),
      layakCount: document.getElementById('layakCount'),
      tidakLayakCount: document.getElementById('tidakLayakCount'),

      filterToggle: document.getElementById('filterToggle'),
      filterPanel: document.getElementById('filterPanel'),
      applyFilter: document.getElementById('applyFilter'),
      resetFilter: document.getElementById('btnResetFilter'),
      clearFiltered: document.getElementById('btnClearFiltered'),

      filterSource: document.getElementById('filterSource'),
      filterClass: document.getElementById('filterClass'),
      filterFrom: document.getElementById('filterFrom'),
      filterTo: document.getElementById('filterTo'),

      exportBtn: document.getElementById('btnExport'),
      clearAllBtn: document.getElementById('btnClearAll'),

      prev: document.getElementById('prevPage'),
      next: document.getElementById('nextPage'),
      pageInfo: document.getElementById('pageInfo'),
    };

    this.init();
  }

  init() {
    this.bindEvents();

    // Hide loading screen (smooth)
    setTimeout(() => {
      if (this.el.loading) {
        this.el.loading.style.opacity = '0';
        setTimeout(() => (this.el.loading.style.display = 'none'), 400);
      }
    }, 600);

    this.loadAll();
  }

  bindEvents() {
    // Filter panel toggle
    this.el.filterToggle?.addEventListener('click', () => {
      this.el.filterPanel?.classList.toggle('active');
    });

    // Close filter panel when clicking outside
    document.addEventListener('click', (e) => {
      const panel = this.el.filterPanel;
      const toggle = this.el.filterToggle;
      if (!panel || !toggle) return;

      if (
        panel.classList.contains('active') &&
        !panel.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        panel.classList.remove('active');
      }
    });

    // Apply filter
    this.el.applyFilter?.addEventListener('click', () => {
      this.offset = 0;
      this.loadAll();
      this.el.filterPanel?.classList.remove('active');
    });

    // Reset filter
    this.el.resetFilter?.addEventListener('click', () => {
      if (this.el.filterSource) this.el.filterSource.value = '';
      if (this.el.filterClass) this.el.filterClass.value = '';
      if (this.el.filterFrom) this.el.filterFrom.value = '';
      if (this.el.filterTo) this.el.filterTo.value = '';
      this.offset = 0;
      this.loadAll();
    });

    // Clear all
    this.el.clearAllBtn?.addEventListener('click', async () => {
      const ok = confirm('Hapus SEMUA riwayat? Tindakan ini tidak bisa dibatalkan.');
      if (!ok) return;
      await this.clearAll();
    });

    // Clear filtered
    this.el.clearFiltered?.addEventListener('click', async () => {
      const filterText = this.describeFilters();
      const ok = confirm(
        `Hapus riwayat sesuai filter saat ini?\n\n${filterText || '(tanpa filter = semua data)'}`
      );
      if (!ok) return;
      await this.clearFiltered();
      this.el.filterPanel?.classList.remove('active');
    });

    // Export
    this.el.exportBtn?.addEventListener('click', () => this.exportCSV());

    // Pagination
    this.el.prev?.addEventListener('click', () => {
      this.offset = Math.max(0, this.offset - this.limit);
      this.loadHistory();
    });
    this.el.next?.addEventListener('click', () => {
      this.offset += this.limit;
      this.loadHistory();
    });
  }

  describeFilters() {
    const parts = [];
    const source = this.el.filterSource?.value || '';
    const cls = this.el.filterClass?.value ?? '';
    const df = this.el.filterFrom?.value || '';
    const dt = this.el.filterTo?.value || '';

    if (source) parts.push(`• Source: ${source}`);
    if (cls !== '') parts.push(`• Status: ${cls === '0' ? 'Layak' : 'Tidak Layak'}`);
    if (df) parts.push(`• Date From: ${df}`);
    if (dt) parts.push(`• Date To: ${dt}`);

    return parts.join('\n');
  }

  buildQueryParams({ includePagination = true } = {}) {
    const params = new URLSearchParams();

    if (includePagination) {
      params.set('limit', String(this.limit));
      params.set('offset', String(this.offset));
    }

    const source = this.el.filterSource?.value || '';
    const cls = this.el.filterClass?.value ?? '';
    const dateFrom = this.el.filterFrom?.value || '';
    const dateTo = this.el.filterTo?.value || '';

    if (source) params.set('source', source);
    if (cls !== '') params.set('cls', cls);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    return params.toString();
  }

  resolveCls(item) {
    const raw = item?.cls ?? item?.class;
    if (raw === 0 || raw === '0') return 0;
    if (raw === 1 || raw === '1') return 1;

    const r = String(item?.reason || '').trim().toLowerCase();
    if (r.startsWith('layak')) return 0;
    if (r.startsWith('tidak layak')) return 1;

    return null;
  }

  formatSource(source) {
    const s = String(source || '').toLowerCase();
    if (s === 'upload') return 'UPLOAD';
    if (s === 'realtime') return 'REALTIME';
    return (source || '-').toString().toUpperCase();
  }

  formatTimestamp(ts) {
    if (!ts) return '-';
    try {
      const d = new Date(String(ts).replace(' ', 'T'));
      if (isNaN(d.getTime())) return ts;

      return d.toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return ts;
    }
  }

  timeAgo(ts) {
    try {
      const d = new Date(String(ts).replace(' ', 'T'));
      if (isNaN(d.getTime())) return '';
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      if (hrs < 24) return `${hrs}h ago`;
      return `${days}d ago`;
    } catch {
      return '';
    }
  }

  cleanReason(reason) {
    const r0 = String(reason || '').trim();
    if (!r0) return '-';
    const r1 = r0.replace(/^(layak|tidak\s*layak)\s*[-—:]\s*/i, '');
    return r1.trim() || '-';
  }

  makeStatusBadge(cls) {
    if (cls === 0) return `<span class="status-badge layak">LAYAK</span>`;
    if (cls === 1) return `<span class="status-badge tidak-layak">TIDAK LAYAK</span>`;
    return `<span class="status-badge">-</span>`;
  }

  makeSourceBadge(source) {
    const s = this.formatSource(source);
    const type = s === 'REALTIME' ? 'realtime' : 'upload';
    return `<span class="source-badge ${type}">${s}</span>`;
  }

  makeConfidence(conf, cls) {
    const pct = Math.max(0, Math.min(1, Number(conf || 0))) * 100;
    const color = cls === 1 ? 'var(--terracotta)' : 'var(--moss)';

    return `
      <div class="confidence">
        <div class="confidence-bar">
          <div class="confidence-fill" style="width:${pct.toFixed(1)}%; background:${color};"></div>
        </div>
        <span class="confidence-value">${pct.toFixed(1)}%</span>
      </div>
    `;
  }

  showEmpty(isEmpty) {
    if (!this.el.empty) return;
    const table = document.querySelector('.table-container');
    const pager = document.querySelector('.pagination-container');

    if (isEmpty) {
      this.el.empty.style.display = 'block';
      if (table) table.style.display = 'none';
      if (pager) pager.style.display = 'none';
    } else {
      this.el.empty.style.display = 'none';
      if (table) table.style.display = 'block';
      if (pager) pager.style.display = 'flex';
    }
  }

  setSkeleton() {
    if (!this.el.body) return;
    this.el.body.innerHTML = Array(5)
      .fill(0)
      .map(
        () => `
      <tr class="skeleton-row">
        <td><div class="skeleton"></div></td>
        <td><div class="skeleton"></div></td>
        <td><div class="skeleton"></div></td>
        <td><div class="skeleton"></div></td>
        <td><div class="skeleton"></div></td>
        <td><div class="skeleton"></div></td>
      </tr>
    `
      )
      .join('');
  }

  async loadAll() {
    await Promise.all([this.loadHistory(), this.loadStatsSafe()]);
  }

  async loadHistory() {
    this.setSkeleton();

    try {
      const qs = this.buildQueryParams({ includePagination: true });
      const res = await fetch(`/api/history?${qs}`);
      if (!res.ok) throw new Error('Failed to fetch history');

      const data = await res.json();

      const items = Array.isArray(data.items) ? data.items : [];
      this.total = Number(data.total ?? data.count ?? items.length);

      this.render(items);
      this.updatePagination(items.length);
      this.showEmpty(items.length === 0);
    } catch (e) {
      console.error(e);
      if (this.el.body) this.el.body.innerHTML = `<tr><td colspan="6">Gagal memuat history.</td></tr>`;
      this.showEmpty(true);
    }
  }

  async loadStatsSafe() {
    const qs = this.buildQueryParams({ includePagination: false });

    try {
      const res = await fetch(`/api/history/stats?${qs}`);
      if (!res.ok) throw new Error('stats endpoint not available');

      const s = await res.json();
      this.setStats(Number(s.total ?? 0), Number(s.layak ?? 0), Number(s.tidakLayak ?? 0));
      return;
    } catch (_) {}

    try {
      const res = await fetch(`/api/history?limit=5000&offset=0&${qs}`);
      if (!res.ok) throw new Error('fallback history for stats failed');
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];

      let layak = 0;
      let tidakLayak = 0;
      for (const it of items) {
        const c = this.resolveCls(it);
        if (c === 0) layak++;
        else if (c === 1) tidakLayak++;
      }
      this.setStats(items.length, layak, tidakLayak);
    } catch (_) {
      this.setStats(0, 0, 0);
    }
  }

  setStats(total, layak, tidakLayak) {
    if (this.el.totalCount) this.el.totalCount.textContent = total;
    if (this.el.layakCount) this.el.layakCount.textContent = layak;
    if (this.el.tidakLayakCount) this.el.tidakLayakCount.textContent = tidakLayak;
  }

  updatePagination(currentLen) {
    const page = Math.floor(this.offset / this.limit) + 1;
    const totalPages = Math.max(1, Math.ceil(this.total / this.limit));

    if (this.el.pageInfo) this.el.pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (this.el.prev) this.el.prev.disabled = this.offset === 0;

    const canNextByTotal = this.total ? (this.offset + this.limit) < this.total : false;
    const canNextByLen = currentLen === this.limit;
    if (this.el.next) this.el.next.disabled = !(canNextByTotal || canNextByLen);
  }

  render(items) {
    if (!this.el.body) return;

    if (!items.length) {
      this.el.body.innerHTML = '';
      return;
    }

    this.el.body.innerHTML = items
      .map((item) => {
        const cls = this.resolveCls(item);
        const status = this.makeStatusBadge(cls);
        const source = this.makeSourceBadge(item.source);
        const conf = this.makeConfidence(item.confidence, cls);
        const reason = this.cleanReason(item.reason);
        const ts = this.formatTimestamp(item.timestamp);
        const ago = this.timeAgo(item.timestamp);

        return `
        <tr>
          <td>
            <div class="timestamp">${ts}</div>
            <div class="time-ago">${ago}</div>
          </td>
          <td>${source}</td>
          <td>${status}</td>
          <td>${conf}</td>
          <td>${reason}</td>
          <td>
            <div class="action-buttons">
              <button class="action-btn" title="Delete" data-del="${item.id}">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    this.el.body.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del');
        await this.deleteOne(id);
      });
    });
  }

  async deleteOne(id) {
    const ok = confirm('Hapus data ini?');
    if (!ok) return;

    try {
      const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      await this.loadAll();
    } catch (e) {
      console.error(e);
      alert('Gagal menghapus data.');
    }
  }

  async clearAll() {
    try {
      const res = await fetch('/api/history/clear', { method: 'POST' });
      if (!res.ok) throw new Error('clear all failed');
      this.offset = 0;
      await this.loadAll();
    } catch (e) {
      console.error(e);
      alert('Gagal clear all.');
    }
  }

  async clearFiltered() {
    // 1) endpoint backend khusus filtered delete
    const qs = this.buildQueryParams({ includePagination: false });

    try {
      const res = await fetch(`/api/history/clear-filtered?${qs}`, { method: 'POST' });
      if (res.ok) {
        this.offset = 0;
        await this.loadAll();
        return;
      }
      // 400 = filter kosong/tidak valid
      if (res.status === 400) {
        const msg = await res.json().catch(() => null);
        alert(msg?.detail || 'Filter kosong/tidak valid. Isi minimal 1 filter.');
        return;
      }
      // kalau 404/405, lanjut fallback
    } catch (_) {}

    // 2) fallback aman: ambil list id lalu delete satu-satu
    try {
      const res = await fetch(`/api/history?limit=5000&offset=0&${qs}`);
      if (!res.ok) throw new Error('fetch for filtered delete failed');
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];

      if (!items.length) {
        alert('Tidak ada data yang cocok dengan filter.');
        return;
      }

      for (const it of items) {
        await fetch(`/api/history/${it.id}`, { method: 'DELETE' });
      }

      this.offset = 0;
      await this.loadAll();
    } catch (e) {
      console.error(e);
      alert('Gagal menghapus sesuai filter.');
    }
  }

  async exportCSV() {
    try {
      const qs = this.buildQueryParams({ includePagination: false });
      const res = await fetch(`/api/export/csv?${qs}`);
      if (!res.ok) throw new Error('export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `douxelle-history-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Export gagal.');
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new HistoryManager();
});
