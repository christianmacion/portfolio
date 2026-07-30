/**
 * data-sources.ts — single source of truth for the public-domain data-source
 * registry rendered on /research → DataSourceList.
 *
 * Standing Order: only sources that are verifiably public-domain, NDA-clean,
 * and known-licence are listed. No proprietary feeds, no employer scrapes,
 * no platform names. Each row carries {name, url_pattern, license, note}
 * so a hiring manager can audit the data lineage with curl.
 *
 * The shape mirrors DataSourceList.astro's `Source` interface. The
 * component imports from here so the registry has exactly one writer.
 * Length is the canonical "12 sources" chrome on /research — derived
 * via `.length`, never hardcoded. (v7.7.0 — extended with `news` and
 * `research` categories for the new live-world feeds.)
 */

export interface DataSource {
  name: string;
  category:
    | 'macro'
    | 'equity-deriv'
    | 'crypto-onchain'
    | 'funding'
    | 'rates'
    | 'commodities'
    | 'fx'
    | 'cftc'
    | 'news'
    | 'research';
  urlPattern: string;
  license: string;
  note?: string;
}

export const dataSources: DataSource[] = [
  {
    name: 'FRED-equivalent (public macro time-series)',
    category: 'macro',
    urlPattern: 'https://fred.stlouisfed.org/ — public CSV download per series',
    license: 'Public domain (US Federal Reserve release)',
    note: 'US macro series, daily/quarterly frequency.',
  },
  {
    name: 'CBOE VIX Historical (free)',
    category: 'equity-deriv',
    urlPattern: 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',
    license: 'Free for non-commercial redistribution',
    note: 'Used by project 04 and 07 — variance risk premium + regime classifier.',
  },
  {
    name: 'Yahoo Finance (delayed quotes, free tier)',
    category: 'equity-deriv',
    urlPattern: 'https://query1.finance.yahoo.com/v7/finance/download/{ticker}',
    license: 'Yahoo terms (delayed ≥15 min, non-commercial)',
    note: 'Daily OHLCV equity / ETF data for cross-sectional and pairs work.',
  },
  {
    name: 'CFTC Commitment of Traders (COT)',
    category: 'cftc',
    urlPattern: 'https://www.cftc.gov/dea/newdeacom.html — annual + weekly disaggregated reports',
    license: 'Public domain (US Government publication)',
    note: 'Positioning baseline for any carry/liquidity signal.',
  },
  {
    name: 'CoinGecko free tier (no API key)',
    category: 'crypto-onchain',
    urlPattern: 'https://api.coingecko.com/api/v3/coins/{id}/market_chart',
    license: 'Free tier, attribution required',
    note: 'Daily and intraday crypto price history across the 18-coin universe.',
  },
  {
    name: 'Public-domain academic datasets (Bailey, López de Prado, Chan)',
    category: 'macro',
    urlPattern: 'https://www.quantresearch.org/ — published companion data',
    license: 'Academic use, attribution required',
    note: 'Replicated baselines for DSR / multiple-testing papers.',
  },
  {
    name: 'Treasury par-yield curve (US Treasury)',
    category: 'rates',
    urlPattern:
      'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv',
    license: 'Public domain (US Treasury publication)',
    note: 'Term-structure ground truth for any rates / curve work.',
  },
  {
    name: 'EIA petroleum spot prices (weekly)',
    category: 'commodities',
    urlPattern: 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm',
    license: 'Public domain (US EIA)',
    note: 'Commodity baseline for cross-asset regime overlays.',
  },
  {
    name: 'Binance public klines (delayed REST)',
    category: 'crypto-onchain',
    urlPattern: 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d',
    license: 'Public REST endpoint, no key required',
    note: 'Daily OHLCV on the BTC/ETH/SOL universe for project 02/03/05.',
  },
  {
    name: 'Binance public funding-rate history (read)',
    category: 'funding',
    urlPattern: 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT',
    license: 'Public REST endpoint, no key required',
    note: 'Source for project 06 funding-carry study.',
  },
  {
    name: 'FRED-equivalent: World Bank open data (macro cross-country)',
    category: 'macro',
    urlPattern: 'https://data.worldbank.org/indicator — open data API',
    license: 'Open licence (CC-BY 4.0)',
    note: 'Cross-country macro for sanity-checking single-country signals.',
  },
  {
    name: 'FRED-equivalent: BIS real-effective-exchange-rate',
    category: 'fx',
    urlPattern: 'https://data.bis.org/topics/RPP',
    license: 'Public (Bank for International Settlements, re-use permitted)',
    note: 'FX basket reference for any carry / FX-overlay discussion.',
  },
  // === v7.7.0 — live-world feeds ===
  {
    name: 'GDELT 2.0 Global Knowledge Graph (event overlay)',
    category: 'news',
    urlPattern: 'https://data.gdeltproject.org/gdeltv2/masterfilelist.txt — 15-minute resolution',
    license: 'CC-BY 4.0 (CAMEO event taxonomy, open redistribution)',
    note: 'Layer C of EarthMap — 24h signal overlay from the global event monitor.',
  },
  {
    name: 'arXiv preprint server (quantitative research)',
    category: 'research',
    urlPattern: 'https://export.arxiv.org/rss/{q-fin,stat.AP,cs.LG,cs.AI,cs.CL}',
    license: 'CC-BY 4.0 (arXiv non-exclusive redistribution)',
    note: 'Feeds ArxivRadar — 5 categories, 20 most-recent papers each build.',
  },
  {
    name: 'Binance public announcements',
    category: 'news',
    urlPattern: 'https://www.binance.com/en/support/announcement — public listing/delisting feed',
    license: 'Public disclosure (no API key required)',
    note: 'LiveWire source — exchange-level delisting / listing signals.',
  },
];

/** Canonical count — single source of truth for "N sources" chrome. (v7.7.0 → 15) */
export const dataSourceCount = dataSources.length;
