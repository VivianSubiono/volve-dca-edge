# Volve DCA Edge — Production Forecasting & Decline Curve Analysis (ML + Edge AI)

**Pilar industri:** Optimasi Produksi & Perencanaan Investasi (OPEX/CAPEX).
**Masalah:** Arps klasik kurang akurat saat ada shut-in / workover. Proyek ini membandingkan Arps hyperbolic dengan XGBoost (lag + rolling features) untuk memprediksi **rasio produksi 30 hari ke depan terhadap rata-rata 30 hari saat ini**, lalu rasio itu dikonversi kembali menjadi **laju minyak (sm³/hari)**.
**Live demo:** https://GANTI-NAMA-KELOMPOK.vercel.app

## Tim
| Nama | NIM | Peran | LinkedIn |
|---|---|---|---|
| ... | ... | ... | ... |

## Struktur
- `src/train.py` — data → fitur → XGBoost → evaluasi vs Arps & persistence → TreeSHAP → ONNX → `public/`
- `src/generate_synthetic.py` — data sintetis (fallback smoke-test, bukan bukti performa)
- `public/` — web statis: `index.html`, `model.onnx`, `samples.json`, `metrics.json`, `team.json`

## Menjalankan lokal
```bash
pip install -r requirements.txt
# 1) Unduh Volve (Equinor Data Village), taruh file Excel produksi di data/raw/ (*.xlsx)
#    Sheet "Daily Production Data". Nama kolom di load_volve() sudah dicocokkan dengan file Volve.
python src/train.py            # tanpa file di data/raw => otomatis pakai data SINTETIS
cd public && python -m http.server 8000   # buka http://localhost:8000
```

## Deploy Vercel
Import repo di Vercel, Framework "Other". `vercel.json` sudah mengarahkan `outputDirectory` ke `public`. Ganti nama project agar URL sesuai `[nama-kelompok].vercel.app`.

## Metodologi & keputusan desain
- **Target = rasio** `y / m30` (`y` = rata-rata laju t+1..t+30, `m30` = rata-rata laju t-29..t), di-clip ke [0, 3]. Laju prediksi = `rasio_prediksi × m30`. Pohon tidak bisa ekstrapolasi skala laju, sedangkan rasio berskala sama antar sumur. Baris dengan `m30 <= 5` dibuang sehingga pembagi tidak pernah nol. Semua metrik (MAE, RMSE, WAPE) dihitung setelah konversi balik ke sm³/hari; `metrics.json` juga memuat MAE di ruang rasio.
- **Split temporal per sumur** (75/25) dengan **gap 30 hari** agar window target tidak bocor ke train.
- **Baseline:** persistence (mean 30 hari) dan Arps hyperbolic yang di-fit ulang pada 180 hari terakhir (hari shut-in dikecualikan dari fit).
- **Metrik:** MAE, RMSE, WAPE. F1/PR-AUC tidak relevan untuk regresi; jelaskan di laporan.
- **XAI:** TreeSHAP (`pred_contribs` XGBoost), dihitung offline; browser hanya menampilkan.
- **Edge:** ONNX ~0.09 MB, inferensi via `onnxruntime-web` (WASM). Paritas ONNX vs XGBoost sudah diuji.

## Keterbatasan (tulis jujur di laporan)
- Angka di repo berasal dari **data Volve asli** (`metrics.json` berisi `data_source: volve`). `src/generate_synthetic.py` hanya untuk smoke-test.
- Jumlah sumur Volve kecil (sekitar 7 produser), varians evaluasi tinggi; pertimbangkan leave-one-well-out.
- Asumsi gap tanggal = shut-in belum tentu benar untuk data asli.
- Belum ada interval ketidakpastian (mis. quantile regression).
- `onnxruntime-web` dan SheetJS sudah di-vendor di `public/vendor/` (tanpa CDN).
- Upload Excel memakai salinan JS dari `prep_well()`/`feats()`; paritas dengan Python sudah diuji pada file Volve (selisih relatif maks < 1e-13).

## Kontribusi
Setiap anggota commit atas bagiannya sendiri (bukan single-committer). Contribution Statement ada di lampiran laporan.
