/**
 * currencies.ts : canonical currency metadata for the live FX + crypto
 * converter at /converter/.
 *
 * Single source of truth for:
 *   - dropdown / pill options (source + target)
 *   - ticker grid (top-N crypto + top-N fiat shown on /markets/)
 *   - chrome labels (symbol glyph, region, decimals)
 *
 * Three buckets:
 *   - FIAT : official ECB reference rates against the EUR (refresh
 *     daily, end-of-day London fix). `ecbKey` is the ECB series key in
 *     the SDMX data-api REST endpoint (e.g. `USD`, `GBP`, `JPY`).
 *     Fiat that ECB does NOT publish (CNY, PHP, INR, IDR, MYR, THB,
 *     KRW, BRL, MXN, ZAR, TWD, VND) are sourced from `yahoo` instead.
 *   - CRYPTO_BINANCE : Binance public REST 24hr ticker. The canonical
 *     pair is X/USDT; the converter computes the implied cross as
 *     `binancePx(USDT/USD) / binancePx(X/USDT)` so the display stays
 *     in fiat.
 *   - CRYPTO_COINGECKO : fallback universe for coins Binance does not
 *     list (e.g. PEPE, WIF, UNI on certain ERC-20 day lists).
 *
 * ECB FX is the canonical anchor: it is the SINGLE official central
 * bank source in the substrate, refreshed daily, and it is public-
 * domain in the EU (Decision ECB/2007/NSP/14). Yahoo Finance is the
 * fallback for non-ECB currencies; CoinGecko fills the Binance gap
 * for ERC-20 altcoins.
 *
 * NB: this file is the ONLY place the converter pulls metadata from.
 * Rates are resolved at runtime by `converter.astro` from the public
 * endpoints; the data file holds the catalog, NOT the values.
 */

export type CurrencyBucket = 'fiat' | 'crypto-binance' | 'crypto-coingecko';

export interface CurrencyMeta {
  /** Internal id; unique key. */
  id: string;
  /** Ticker shown in the UI (USD, EUR, BTC, XAU…). */
  symbol: string;
  /** Long display name (e.g. "US Dollar", "Bitcoin"). */
  name: string;
  /** Region / category chip ("EUROPE", "ASEAN", "MAJOR", "PRECIOUS"). */
  region: string;
  /** Decimals used in conversion display (FX = 4, crypto = 6-8, gold = 2). */
  decimals: number;
  /** Where the live rate comes from. */
  source: CurrencyBucket;
  /**
   * ECB series key (only for `source === 'fiat'` AND ECB-published).
   * `undefined` means Yahoo Finance is the fallback source.
   */
  ecbKey?: string;
  /**
   * Yahoo Finance ticker (only for `source === 'fiat'` and non-ECB).
   * Yahoo pairs are quoted as XXX=X (USD=X, EUR=X, PHP=X, etc.).
   */
  yahooTicker?: string;
  /**
   * Binance trading symbol (only for `source === 'crypto-binance'`).
   * Always quoted against USDT (the deepest book on retail venues).
   */
  binanceSymbol?: string;
  /**
   * CoinGecko coin id (only for `source === 'crypto-coingecko'`).
   * Used as the path component for /coins/markets.
   */
  coingeckoId?: string;
  /** Display order (lower = first in the dropdown / row). */
  order: number;
}

/* ============================================================================
 * FIAT : ECB official anchors + Yahoo fallback.
 * Top-20 covers the major + ASEAN + BRICS + commodity-currency set the
 * spec calls for. ECB is the primary EU central bank; non-ECB pads to 20.
 * ========================================================================== */

const ECB_FIAT: CurrencyMeta[] = [
  { id: 'EUR', symbol: 'EUR', name: 'Euro',                region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'EUR', order: 1  },
  { id: 'USD', symbol: 'USD', name: 'US Dollar',           region: 'AMERICAS',  decimals: 4, source: 'fiat', ecbKey: 'USD', order: 2  },
  { id: 'GBP', symbol: 'GBP', name: 'Pound Sterling',      region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'GBP', order: 3  },
  { id: 'JPY', symbol: 'JPY', name: 'Japanese Yen',        region: 'ASIA',      decimals: 2, source: 'fiat', ecbKey: 'JPY', order: 4  },
  { id: 'CHF', symbol: 'CHF', name: 'Swiss Franc',         region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'CHF', order: 5  },
  { id: 'AUD', symbol: 'AUD', name: 'Australian Dollar',   region: 'OCEANIA',   decimals: 4, source: 'fiat', ecbKey: 'AUD', order: 6  },
  { id: 'CAD', symbol: 'CAD', name: 'Canadian Dollar',     region: 'AMERICAS',  decimals: 4, source: 'fiat', ecbKey: 'CAD', order: 7  },
  { id: 'NZD', symbol: 'NZD', name: 'New Zealand Dollar',  region: 'OCEANIA',   decimals: 4, source: 'fiat', ecbKey: 'NZD', order: 8  },
  { id: 'SEK', symbol: 'SEK', name: 'Swedish Krona',       region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'SEK', order: 9  },
  { id: 'NOK', symbol: 'NOK', name: 'Norwegian Krone',     region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'NOK', order: 10 },
  { id: 'DKK', symbol: 'DKK', name: 'Danish Krone',        region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'DKK', order: 11 },
  { id: 'PLN', symbol: 'PLN', name: 'Polish Zloty',        region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'PLN', order: 12 },
  { id: 'CZK', symbol: 'CZK', name: 'Czech Koruna',        region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'CZK', order: 13 },
  { id: 'HUF', symbol: 'HUF', name: 'Hungarian Forint',    region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'HUF', order: 14 },
  { id: 'RON', symbol: 'RON', name: 'Romanian Leu',        region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'RON', order: 15 },
  { id: 'BGN', symbol: 'BGN', name: 'Bulgarian Lev',       region: 'EUROPE',    decimals: 4, source: 'fiat', ecbKey: 'BGN', order: 16 },
  { id: 'ISK', symbol: 'ISK', name: 'Icelandic Krona',     region: 'EUROPE',    decimals: 2, source: 'fiat', ecbKey: 'ISK', order: 17 },
  { id: 'TRY', symbol: 'TRY', name: 'Turkish Lira',        region: 'EMG',       decimals: 4, source: 'fiat', ecbKey: 'TRY', order: 18 },
];

/* Yahoo Finance fallback for non-ECB currencies. Yahoo exposes delayed
 * (>= 15 min) quotes at zero cost; USD=X = USD per 1 unit of the
 * quote currency. */
const YAHOO_FIAT: CurrencyMeta[] = [
  { id: 'PHP', symbol: 'PHP', name: 'Philippine Peso',     region: 'ASEAN',     decimals: 4, source: 'fiat', yahooTicker: 'PHP=X', order: 19 },
  { id: 'SGD', symbol: 'SGD', name: 'Singapore Dollar',    region: 'ASEAN',     decimals: 4, source: 'fiat', yahooTicker: 'SGD=X', order: 20 },
  { id: 'HKD', symbol: 'HKD', name: 'Hong Kong Dollar',    region: 'ASIA',      decimals: 4, source: 'fiat', yahooTicker: 'HKD=X', order: 21 },
  { id: 'CNY', symbol: 'CNY', name: 'Chinese Yuan',        region: 'ASIA',      decimals: 4, source: 'fiat', yahooTicker: 'CNY=X', order: 22 },
  { id: 'INR', symbol: 'INR', name: 'Indian Rupee',        region: 'ASIA',      decimals: 4, source: 'fiat', yahooTicker: 'INR=X', order: 23 },
  { id: 'IDR', symbol: 'IDR', name: 'Indonesian Rupiah',   region: 'ASEAN',     decimals: 2, source: 'fiat', yahooTicker: 'IDR=X', order: 24 },
  { id: 'MYR', symbol: 'MYR', name: 'Malaysian Ringgit',   region: 'ASEAN',     decimals: 4, source: 'fiat', yahooTicker: 'MYR=X', order: 25 },
  { id: 'THB', symbol: 'THB', name: 'Thai Baht',           region: 'ASEAN',     decimals: 4, source: 'fiat', yahooTicker: 'THB=X', order: 26 },
  { id: 'KRW', symbol: 'KRW', name: 'South Korean Won',    region: 'ASIA',      decimals: 2, source: 'fiat', yahooTicker: 'KRW=X', order: 27 },
  { id: 'TWD', symbol: 'TWD', name: 'Taiwan Dollar',       region: 'ASIA',      decimals: 4, source: 'fiat', yahooTicker: 'TWD=X', order: 28 },
  { id: 'VND', symbol: 'VND', name: 'Vietnamese Dong',     region: 'ASEAN',     decimals: 0, source: 'fiat', yahooTicker: 'VND=X', order: 29 },
  { id: 'BRL', symbol: 'BRL', name: 'Brazilian Real',      region: 'BRICS',     decimals: 4, source: 'fiat', yahooTicker: 'BRL=X', order: 30 },
  { id: 'MXN', symbol: 'MXN', name: 'Mexican Peso',        region: 'LATAM',     decimals: 4, source: 'fiat', yahooTicker: 'MXN=X', order: 31 },
  { id: 'ZAR', symbol: 'ZAR', name: 'South African Rand',  region: 'BRICS',     decimals: 4, source: 'fiat', yahooTicker: 'ZAR=X', order: 32 },
];

/* ============================================================================
 * CRYPTO : Binance public REST 24hr ticker for the top-10 by retail
 * turnover, plus 2 precious metals (XAU = gold, XAG = silver) that are
 * quoted as commodities on Yahoo Finance rather than as cryptos.
 * ========================================================================== */

const CRYPTO_BINANCE: CurrencyMeta[] = [
  { id: 'BTC', symbol: 'BTC', name: 'Bitcoin',  region: 'CRYPTO', decimals: 6, source: 'crypto-binance', binanceSymbol: 'BTCUSDT', order: 1  },
  { id: 'ETH', symbol: 'ETH', name: 'Ethereum', region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'ETHUSDT', order: 2  },
  { id: 'SOL', symbol: 'SOL', name: 'Solana',   region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'SOLUSDT', order: 3  },
  { id: 'BNB', symbol: 'BNB', name: 'BNB',      region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'BNBUSDT', order: 4  },
  { id: 'XRP', symbol: 'XRP', name: 'XRP',      region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'XRPUSDT', order: 5  },
  { id: 'ADA', symbol: 'ADA', name: 'Cardano',  region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'ADAUSDT', order: 6  },
  { id: 'DOGE', symbol: 'DOGE', name: 'Dogecoin', region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'DOGEUSDT', order: 7 },
  { id: 'AVAX', symbol: 'AVAX', name: 'Avalanche', region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'AVAXUSDT', order: 8 },
  { id: 'LINK', symbol: 'LINK', name: 'Chainlink', region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'LINKUSDT', order: 9 },
  { id: 'MATIC', symbol: 'MATIC', name: 'Polygon', region: 'CRYPTO', decimals: 4, source: 'crypto-binance', binanceSymbol: 'MATICUSDT', order: 10 },
];

/* Precious metals + Oil quotes via Yahoo Finance chart endpoint. We
 * classify them as fiat-source (the converter math treats them like a
 * per-dollar quote) but they sit separately in the dropdown to keep
 * the chrome readable. */
const METALS_OIL: CurrencyMeta[] = [
  { id: 'XAU', symbol: 'XAU', name: 'Gold spot',   region: 'PRECIOUS', decimals: 2, source: 'fiat', yahooTicker: 'GC=F', order: 100 },
  { id: 'XAG', symbol: 'XAG', name: 'Silver spot', region: 'PRECIOUS', decimals: 2, source: 'fiat', yahooTicker: 'SI=F', order: 101 },
];

export const ALL_CURRENCIES: CurrencyMeta[] = [
  ...ECB_FIAT,
  ...YAHOO_FIAT,
  ...CRYPTO_BINANCE,
  ...METALS_OIL,
].sort((a, b) => a.order - b.order || a.symbol.localeCompare(b.symbol));

/* Fiat-only subset for the FOREX(ECB) tab on /converter/ */
export const FIAT_CURRENCIES: CurrencyMeta[] = ALL_CURRENCIES.filter(
  (c) => c.source === 'fiat',
);

/* Crypto subset for the CRYPTO tabs */
export const CRYPTO_CURRENCIES: CurrencyMeta[] = ALL_CURRENCIES.filter(
  (c) => c.source === 'crypto-binance',
);

/* Default currency set for the converter on first paint:
 *  - source  : USD   (universal anchor)
 *  - target  : PHP   (Owner home base = PH; matches the markets tape) */
export const DEFAULT_SOURCE = 'USD';
export const DEFAULT_TARGET = 'PHP';

/* The full BBC-style ticker row the rates table renders. Curated to
 * mix majors, ASEAN, BRICS, and the top crypto so a hiring manager
 * sees what a quant desk cares about without scrolling. */
export const DEFAULT_RATE_ROWS: string[] = [
  // ECB majors (10)
  'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'CNY', 'SGD', 'HKD',
  // ASEAN + emerging (8)
  'PHP', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'THB', 'IDR',
  // Crypto top (10)
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'MATIC',
  // Precious (2)
  'XAU', 'XAG',
];

/* The 8-row set that lives on /markets/ as the mini-converter widget.
 * Top-6 crypto + top-2 fiat, in view order. */
export const MARKETS_PREVIEW_ROWS: string[] = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA',
  'USD', 'PHP',
];

/** Get the metadata for a currency id (returns undefined if unknown). */
export function getCurrencyMeta(id: string): CurrencyMeta | undefined {
  return ALL_CURRENCIES.find((c) => c.id === id);
}
