import { defineCustomElement } from 'vue';

const VueScrapeStats = defineCustomElement({
  props: {
    valid: { type: Number, default: 0 },
    discarded: { type: Number, default: 0 }
  },
  template: `
    <section class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <h3 style="margin:0 0 8px;font-size:14px;font-weight:700;color:#065f46">Vue Metrics Widget</h3>
      <div style="display:flex;gap:12px">
        <span style="font-size:13px;color:#065f46">Validas: <strong>{{ valid }}</strong></span>
        <span style="font-size:13px;color:#92400e">Descartadas: <strong>{{ discarded }}</strong></span>
      </div>
    </section>
  `
});

if (!customElements.get('vue-scrape-stats')) {
  customElements.define('vue-scrape-stats', VueScrapeStats);
}

