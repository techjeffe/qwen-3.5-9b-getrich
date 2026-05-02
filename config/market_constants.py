"""
Market constants for symbol relevance keyword matching.

These mappings are LLM-tuned for relevance filtering in the sentiment analysis pipeline.
DO NOT simplify or modify the keyword lists — they are calibrated for precision.
"""

SYMBOL_RELEVANCE_TERMS: dict[str, list[str]] = {
    "USO": [
        # Commodity and supply terms
        "oil", "crude", "gasoline", "distillate", "refinery", "opec", "energy",
        "barrel", "petroleum", "diesel", "brent", "wti", "tanker", "pipeline",
        "natural gas", "lng", "shale", "fracking", "shipping lane",
        "supply disruption", "crude export", "crude imports", "oilfield",
        # Geo-political terms that are OIL-SPECIFIC — not country names alone,
        # which would pull in all geopolitical news regardless of oil relevance
        "strait of hormuz", "oil sanction", "energy sanction", "oil supply",
        "oil production", "oil export", "oil shipment", "energy supply",
        "hormuz", "hormuz shipping", "hormuz transit",
        "opec cut", "opec quota", "output cut", "production cut",
        "russia oil", "iran oil", "iranian oil", "venezuela oil",
    ],
    "IBIT": [
        "bitcoin", "btc", "crypto", "cryptocurrency", "blockchain",
        "stablecoin", "defi", "nft", "altcoin", "ethereum", "eth",
        "sec crypto", "cftc crypto", "crypto regulation", "crypto etf",
        "digital asset", "mining", "halving", "satoshi",
        "m2", "liquidity", "dollar strength",
    ],
    "QQQ": [
        "tech", "technology", "ai", "artificial intelligence", "semiconductor",
        "chip", "software", "nasdaq", "megacap", "cloud", "data center",
        "apple", "microsoft", "nvidia", "google", "meta", "amazon",
        "antitrust", "big tech", "interest rate", "rate cut", "rate hike",
        "earnings", "valuation", "growth stock",
    ],
    "SPY": [
        "economy", "economic", "fed", "federal reserve", "rates", "inflation",
        "unemployment", "labor market", "jobs report", "earnings season",
        "credit spread", "high yield", "recession", "gdp", "growth",
        "stock market", "s&p", "dow jones", "wall street", "risk appetite",
        "tariff", "trade war", "fiscal policy",
    ],
}