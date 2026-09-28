// SheetJS, loaded on demand.

// The Excel reader is ~900 KB, so it loads on the first import instead of
// holding up every page load.
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxLoading = null;

export function loadXlsx() {
  if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_URL;
      script.onload = () => (typeof XLSX !== 'undefined' ? resolve(XLSX) : reject(new Error('no XLSX')));
      script.onerror = () => reject(new Error('offline'));
      document.head.appendChild(script);
    }).catch(() => {
      xlsxLoading = null; // allow a retry once back online
      throw new Error('The Excel reader did not load. Check your internet connection and try again.');
    });
  }
  return xlsxLoading;
}
