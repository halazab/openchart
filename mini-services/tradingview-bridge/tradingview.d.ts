/**
 * Type shims for the untyped `@mathieuc/tradingview` library (v3.5.x).
 * Only the surface used by this bridge is declared.
 */

declare module '@mathieuc/tradingview' {
  export interface TVPeriod {
    time: number; // UTC seconds
    open: number;
    close: number;
    max: number; // high
    min: number; // low
    volume: number;
    max?: number | undefined;
  }

  export interface TVSymbolInfos {
    symbol?: string;
    description?: string;
    exchange?: string;
    type?: string;
    currency_id?: string;
    pricescale?: number;
    minmov?: number;
    session?: string;
    'session-regular'?: string;
    timezone?: string;
    subsession_id?: string;
    [key: string]: unknown;
  }

  export class ChartSession {
    /** Periods sorted NEWEST first. */
    get periods(): TVPeriod[];
    get infos(): TVSymbolInfos;
    setMarket(
      symbol: string,
      options?: {
        timeframe?: string;
        range?: number;
        to?: number;
        from?: number;
        session?: 'regular' | 'extended';
        currency?: string;
        adjustment?: 'splits' | 'dividends';
        type?: string;
      },
    ): void;
    setSeries(timeframe?: string, range?: number, reference?: number | null): void;
    fetchMore(number?: number): Promise<void>;
    onUpdate(cb: (...args: unknown[]) => void): void;
    onSymbolLoaded(cb: (...args: unknown[]) => void): void;
    onError(cb: (...err: unknown[]) => void): void;
    onClose(cb?: (...args: unknown[]) => void): void;
    delete(): void;
  }

  export interface TVQuoteData {
    s?: string;
    lp?: number; // last price
    ch?: number; // change
    chp?: number; // change percent
    description?: string;
    exchange?: string;
    type?: string;
    currency_id?: string;
    current_session?: string;
    high_price?: number;
    low_price?: number;
    open_price?: number;
    prev_close_price?: number;
    volume?: number;
    [key: string]: unknown;
  }

  export class QuoteMarket {
    constructor(symbol: string, session?: 'regular' | 'extended');
    onData(cb: (data: TVQuoteData) => void): void;
    onLoaded(cb: () => void): void;
    onError(cb: (...err: unknown[]) => void): void;
    onEvent(cb: (ev: string, data: unknown) => void): void;
    close(): void;
  }

  export class QuoteSession {
    Market: new (symbol: string, session?: 'regular' | 'extended') => QuoteMarket;
    send(event: string, params: unknown[]): void;
    setFields(fields: string[]): void;
    delete(): void;
  }

  export interface SearchMarketResult {
    id: string; // 'PREFIX:SYMBOL'
    exchange: string;
    fullExchange: string;
    symbol: string;
    description: string;
    type: string;
  }

  export class Client {
    constructor(options?: { token?: string; signature?: string; DEBUG?: boolean });
    get isLogged(): boolean;
    get isOpen(): boolean;
    Session: {
      Chart: new () => ChartSession;
      Quote: new () => QuoteSession;
    };
    onConnected(cb: () => void): void;
    onDisconnected(cb: () => void): void;
    onLogged(cb: () => void): void;
    onError(cb: (...err: unknown[]) => void): void;
    end(): void;
  }

  const TradingViewAPI: {
    Client: typeof Client;
    searchMarketV3(
      search: string,
      filter?: string,
      offset?: number,
    ): Promise<SearchMarketResult[]>;
    getIndicator(id: string): Promise<unknown>;
  };

  export default TradingViewAPI;
}
