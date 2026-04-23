"""
Geopolitical Risk Analysis Prompts.
Specialized prompts for detecting market bluster vs policy changes,
and for the two-stage entity-extraction → reasoning pipeline.
"""

import re

# ============================================================================
# STAGE 1: THEMATIC & ENTITY MAPPING
# Maps news articles to tracked tickers via proxy terms before reasoning.
# ============================================================================

# Default proxy terms per ticker.  Custom symbols get a fallback rule.
TICKER_PROXY_MAP: dict[str, list[str]] = {
    "USO": [
        "oil", "crude", "petroleum", "OPEC", "barrel", "WTI", "Brent",
        "refinery", "gasoline", "fuel", "energy supply", "pipeline",
        "LNG", "natural gas", "shale", "fracking", "tanker", "shipping lane",
        "supply disruption", "crude export", "crude imports", "oilfield",
        # Oil-specific geopolitical terms — not bare country names, which pull in
        # unrelated political news that has no direct commodity price impact
        "strait of hormuz", "oil sanction", "energy sanction",
        "hormuz", "hormuz shipping", "hormuz transit",
        "oil supply", "oil production", "oil export", "oil shipment",
        "russia oil", "iran oil", "iranian oil", "venezuela oil", "opec cut",
        "output cut", "production cut",
    ],
    "BITO": [
        "bitcoin", "BTC", "crypto", "cryptocurrency", "blockchain",
        "satoshi", "halving", "digital asset", "ethereum", "ETH",
        "stablecoin", "DeFi", "NFT", "altcoin", "mining",
        "sec crypto", "crypto regulation", "crypto ETF", "dollar strength",
    ],
    "QQQ": [
        "nasdaq", "tech sector", "technology stocks", "semiconductors",
        "chips", "AI", "artificial intelligence", "megacap tech",
        "cloud computing", "data center", "software", "big tech",
        "antitrust", "data privacy", "interest rate", "rate cut", "rate hike",
        "apple", "microsoft", "nvidia", "google", "meta", "amazon",
    ],
    "SPY": [
        "S&P 500", "S&P500", "stock market", "equities", "wall street",
        "dow jones", "economy", "recession", "GDP", "inflation",
        "interest rates", "Federal Reserve", "Fed", "employment",
        "earnings season", "credit spread", "tariff", "trade war", "fiscal",
    ],
}


def normalize_text_for_matching(text: str) -> str:
    """Normalize text so simple substring matching catches common punctuation variants."""
    lowered = str(text or "").lower()
    lowered = lowered.replace("&", " and ")
    lowered = re.sub(r"[-_/]", " ", lowered)
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def expand_proxy_terms_for_matching(terms: list[str]) -> list[str]:
    """Expand proxy terms with a few high-value variants for simple substring matching."""
    expanded: set[str] = set()
    suffix_pairs = [
        (" sanction", " sanctions"),
        (" export", " exports"),
        (" imports", " import"),
        (" supply", " supplies"),
        (" cut", " cuts"),
        (" quota", " quotas"),
        (" barrel", " barrels"),
        (" tanker", " tankers"),
        (" pipeline", " pipelines"),
        (" refinery", " refineries"),
        (" shipment", " shipments"),
        (" disruption", " disruptions"),
        (" lane", " lanes"),
    ]

    for term in terms:
        normalized = normalize_text_for_matching(term)
        if not normalized:
            continue
        expanded.add(normalized)
        for singular, plural in suffix_pairs:
            if normalized.endswith(singular):
                expanded.add(normalized[: -len(singular)] + plural)
            if normalized.endswith(plural):
                expanded.add(normalized[: -len(plural)] + singular)

    return sorted(expanded)

STAGE1_EXTRACTION_PROMPT = """TASK: Classify each numbered headline for relevance to tracked financial instruments.

OUTPUT FORMAT: Return a single JSON object with one key "classifications" whose value is an array — one entry per headline index.

Tracked instruments and proxy terms:
{proxy_map_text}

Rules:
- Mark relevant=true if the headline touches the asset, its sector, a proxy term, or any macro factor (rates, inflation, war, regulation, trade policy) that could move these instruments.
- When in doubt, mark relevant=true. It is better to include a borderline article than to miss market-moving news.
- Only mark relevant=false for headlines that are clearly unrelated (sports, celebrity, local weather, entertainment).
- For tickers marked INFER: use your knowledge of that company or asset's sector and news drivers as proxy terms.
- Every headline index from 0 to N-1 MUST appear in the output array.

Required output format:
{{"classifications": [
  {{"index": 0, "relevant": true, "tickers": ["USO"], "proxy_terms": ["crude oil", "OPEC"]}},
  {{"index": 1, "relevant": false, "tickers": [], "proxy_terms": []}}
]}}

Headlines to classify:
{headlines}"""

STAGE2_PROXY_CONTEXT = """
ENTITY MAPPING CONTEXT (from pre-processing):
The following proxy terms were identified in the source articles as mapping to {symbol}:
  {proxy_terms}

CRITICAL INSTRUCTION: Even if "{symbol}" is not mentioned by name in the articles, attribute the sentiment to {symbol} if the underlying asset or any of the above proxy terms are discussed. Your reasoning MUST cite the specific proxy term used (e.g. "The article mentions 'crude oil prices falling' which maps to USO").
"""


def build_proxy_map_text(symbols: list[str]) -> str:
    """Format the proxy map for the Stage 1 prompt, including any custom symbols."""
    lines = []
    for sym in symbols:
        proxies = TICKER_PROXY_MAP.get(sym.upper())
        if proxies:
            lines.append(f"- {sym}: {', '.join(proxies)}")
        else:
            lines.append(
                f"- {sym}: INFER — use your knowledge to identify what company or asset '{sym}' represents, "
                f"its industry, key products or holdings, notable executives, and typical news proxy terms"
            )
    return "\n".join(lines)


def format_stage1_extraction_prompt(
    headlines: "list[str] | list[tuple[int, str]]",
    symbols: list[str],
) -> str:
    """Build the Stage 1 entity-extraction prompt.

    headlines may be a plain list of strings (auto-numbered 0…N)
    or a list of (original_index, text) tuples for batched calls.
    """
    if headlines and isinstance(headlines[0], tuple):
        numbered = "\n".join(f"{i}. {h}" for i, h in headlines)
    else:
        numbered = "\n".join(f"{i}. {h}" for i, h in enumerate(headlines))
    return STAGE1_EXTRACTION_PROMPT.format(
        proxy_map_text=build_proxy_map_text(symbols),
        headlines=numbered,
    )


SYMBOL_KEYWORD_GENERATION_PROMPT = """List 15-20 keywords and proxy terms that appear in news articles likely to affect the stock or asset {symbol}.

Include:
- Company or fund name and common abbreviations
- Key products, services, or major holdings
- Sector and industry terms
- Notable competitors or sector peers
- Relevant macro factors (commodities, rates, regulation topics)
- Common news triggers for this ticker

Return JSON only, no other text:
{{"terms": ["term1", "term2", ...]}}"""


def format_keyword_generation_prompt(symbol: str) -> str:
    return SYMBOL_KEYWORD_GENERATION_PROMPT.format(symbol=symbol)


def format_stage2_proxy_appendix(symbol: str, proxy_terms: list[str]) -> str:
    """Return the proxy-context block to inject into Stage 2 specialist prompts."""
    if not proxy_terms:
        return ""
    return STAGE2_PROXY_CONTEXT.format(
        symbol=symbol,
        proxy_terms=", ".join(proxy_terms),
    )


RED_TEAM_REVIEW_PROMPT = """You are a Senior Quantitative Risk Manager performing a red-team review of trading signals.
Challenge the current recommendations — do not default to agreement.

STRICT BREVITY RULES — violating these causes parse failures:
- summary: 1 sentence, max 20 words
- portfolio_risks: max 2 items, each max 10 words
- source_bias_notes: max 15 words (or empty string if no bias)
- thesis: max 15 words, cite one specific headline or metric
- antithesis: max 15 words, cite one specific risk or counter-indicator
- evidence: max 3 items, each max 10 words
- key_risks: max 3 items, each max 8 words
- atr_basis: max 10 words (e.g. "ATR 1.2, stop at 1.5x ATR")
- rationale: max 20 words explaining any signal change (or "Confirmed" if unchanged)

Return JSON only — no markdown, no commentary, no trailing text after the closing brace.

Return exactly this JSON (no extra fields):
{{
  "summary": string,
  "portfolio_risks": [string],
  "source_bias_penalty_applied": boolean,
  "source_bias_notes": string,
  "symbol_reviews": [
    {{
      "symbol": string,
      "current_recommendation": string,
      "thesis": string,
      "antithesis": string,
      "evidence": [string],
      "key_risks": [string],
      "adjusted_signal": "BUY" | "SELL" | "HOLD",
      "adjusted_urgency": "LOW" | "MEDIUM" | "HIGH",
      "atr_basis": string,
      "rationale": string
    }}
  ]
}}

Do NOT include adjusted_confidence or stop_loss_pct — Python computes those.

Context:
{context_json}
"""


def format_red_team_review_prompt(context_json: str) -> str:
    return RED_TEAM_REVIEW_PROMPT.format(context_json=context_json)

# ============================================================================
# MARKET BLUSTER DETECTION PROMPT
# Identifies hype without substantive policy impact
# ============================================================================

MARKET_BLUSTER_PROMPT = """You are a geopolitical risk analyst specializing in detecting market bluster (hype without substance).

Analyze the following text for signs of market bluster. Market bluster is characterized by:
- Exaggerated language about market impacts
- Vague promises without concrete policy details
- Emotional appeals over factual statements
- Lack of specific implementation timelines or mechanisms
- Use of sensationalist keywords (explosion, skyrocket, crash, etc.)

Text to analyze:
{text}

Return your analysis in this exact JSON format:
{{
  "is_bluster": boolean,
  "bluster_score": float,  // -1.0 (strong bluster) to +1.0 (no bluster)
  "confidence": float,     // 0.0 to 1.0
  "reasoning": string,     // Brief explanation of your analysis
  "bluster_indicators": [string],  // List of keywords/phrases indicating bluster
  "substance_indicators": [string] // List of indicators showing actual substance
}}

Scoring guidelines:
- bluster_score = -1.0: Clear hype with no policy substance
- bluster_score = -0.5 to -0.8: Strong bluster signals
- bluster_score = -0.2 to -0.4: Moderate bluster
- bluster_score = 0.0: Neutral (mixed signals)
- bluster_score > 0.0: Substantive content, no bluster

Keywords that indicate bluster: "explosion", "skyrocket", "crash", "boom", "historic", 
"unprecedented", "game-changer", "revolutionary", "destined to", "will change everything"

Keywords that indicate substance: specific dates, dollar amounts, regulatory language,
legislative references, implementation details, named officials, concrete mechanisms"""


# ============================================================================
# POLICY CHANGE DETECTION PROMPT
# Identifies actual policy/regulatory changes with market impact
# ============================================================================

POLICY_CHANGE_PROMPT = """You are a geopolitical risk analyst specializing in detecting policy changes.

Analyze the following text for signs of policy changes that could impact financial markets.
Focus on:
- Government announcements or regulatory actions
- Legislative proposals or enacted laws
- Executive orders or official statements from leadership
- Sanctions, trade restrictions, or economic measures
- Military actions with economic implications

Text to analyze:
{text}

Return your analysis in this exact JSON format:
{{
  "is_policy_change": boolean,
  "policy_score": float,   // 0.0 (no policy) to +1.0 (significant policy change)
  "confidence": float,     // 0.0 to 1.0
  "reasoning": string,     // Brief explanation of your analysis
  "policy_indicators": [string],  // List of keywords/phrases indicating policy
  "impact_severity": "low" | "medium" | "high",
  "policy_type": string    // e.g., "sanctions", "trade", "regulatory", "military", "fiscal"
}}

Scoring guidelines:
- policy_score = 0.0: No policy content detected
- policy_score = 0.3 to 0.5: Minor policy mention or announcement
- policy_score = 0.6 to 0.8: Significant policy action
- policy_score > 0.8: Major policy change with clear market impact

Impact severity guidelines:
- low: General statements, no immediate market impact
- medium: Specific actions affecting certain sectors
- high: Broad economic implications, market-moving events

Policy type classification:
- sanctions: Economic sanctions or trade restrictions
- trade: Tariffs, import/export policies, trade agreements
- regulatory: Financial regulations, compliance requirements
- military: Military actions with economic consequences
- fiscal: Government spending, taxation, monetary policy
- crypto_regulation: Cryptocurrency/blockchain policy and regulation (affects BITO, QQQ)"""


# ============================================================================
# COMBINED ANALYSIS PROMPT
# Comprehensive analysis for trading signal generation
# ============================================================================

COMBINED_ANALYSIS_PROMPT = """You are a geopolitical risk analyst writing for a trader who needs a clear, shareable explanation.

Analyze the following text comprehensively to determine if it represents:
1. Market bluster (hype without substance) - typically leads to SHORT signals on USO/BITO
2. Policy change (substantive action) - can lead to LONG or SHORT depending on direction

Text to analyze:
{text}

Return your analysis in this exact JSON format:
{{
  "market_bluster": {{
    "is_bluster": boolean,
    "bluster_score": float,  // -1.0 to +1.0
    "confidence": float,
    "reasoning": string
  }},
  "policy_change": {{
    "is_policy_change": boolean,
    "policy_score": float,   // 0.0 to +1.0
    "impact_severity": "low" | "medium" | "high",
    "confidence": float,
    "reasoning": string
  }},
  "trading_signal": {{
    "signal_type": "LONG" | "SHORT" | "HOLD",
    "confidence_score": float,  // 0.0 to +1.0 - confidence in analysis accuracy
    "conviction_level": "LOW" | "MEDIUM" | "HIGH",  // conviction in thesis (LOW=reactive, MEDIUM=swing, HIGH=structural multi-day)
    "urgency": "LOW" | "MEDIUM" | "HIGH",
    "trading_type": "SCALP" | "SWING" | "POSITION" | "VOLATILE_EVENT",  // expected trade duration
    "action_if_already_in_position": "HOLD" | "EXIT" | "ADD" | "TAKE_PROFIT",
    "reasoning": string,
    "holding_period_hours": int  // 1-720 hours based on trading_type (SCALP: 1-2, SWING: 4-24, POSITION: 24-168, VOLATILE_EVENT: 1-4)
  }},
  "overall_assessment": string,  // Brief summary of the situation
  "supporting_points": [string],  // 3-6 concrete observations from the text
  "headline_citations": [string],  // 2-5 short source-aware references like "BBC: Iran missile strike confirmed"
  "analyst_writeup": string,  // 120-220 words, plain English, explicitly explain WHY the signal is LONG/SHORT/HOLD using concrete items from the text
  "symbol_impacts": {{
    "USO": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }},
    "BITO": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }},
    "QQQ": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }},
    "SPY": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }}
  }}
}}

Signal generation rules:
- SHORT signal: Strong bluster (bluster_score < -0.5) with no substantive policy -> take SHORT on most symbols
- LONG signal: Significant substantive policy change (policy_score > 0.7) that positively impacts the target sector
  * Oil/energy policy news positive for energy -> LONG USO
  * Crypto-friendly regulation or announcement -> LONG BITO
  * Dovish monetary policy or growth-friendly fiscal policy -> LONG QQQ/SPY
  * Negative geopolitical developments (war, sanctions) -> avoid LONG equities (SHORT QQQ/SPY), consider LONG USO (safe-haven oil)
- HOLD signal: Mixed signals, low confidence, neutral content, or conflicting headlines

Urgency levels:
- LOW: Minor developments, incremental news, wait for confirmation
- MEDIUM: Notable developments with clear impact, monitor for confirmation
- HIGH: Immediate action warranted (major policy change, crisis, breaking military action)

Write the analyst_writeup so it is useful to share with another person:
- mention the most important specific claims or headlines from the text
- separate rumor / rhetoric from confirmed policy action
- say what is driving the signal decision
- do not use vague filler like "aggregated across all analyzed sources"
- if the text contains conflicting items, say that explicitly

For symbol_impacts:
- USO should reflect oil / energy / Middle East supply sensitivity (highly affected by geopolitical risk, sanctions, military action)
- BITO should reflect crypto risk appetite, liquidity, regulation, and macro fear (affected by crypto regulation, inflation, USD strength, regulatory crackdowns)
- QQQ should reflect large-cap tech / growth sensitivity to rates, war risk, risk appetite, and tech-specific regulation
- SPY should reflect broader equity / macro sensitivity to economic policy, war risk, and systemic risk
- CRITICAL: Do not copy the same reasoning into all four symbols - analyze the specific transmission mechanism for each
- Consider directional impact: "crypto_regulation" typically hurts BITO near-term but QQQ may benefit if it reduces regulatory uncertainty
- Military/geopolitical risk: typically helps USO (energy) and hurts QQQ/SPY (growth stocks), neutral to BITO unless tied to specific sanctions on crypto

Conviction level guidance (to reduce trading churn):
- LOW conviction (1-2 hour expected hold): Breaking news with immediate headline impact but no fundamental change. Reactive bluster. Positions likely to reverse quickly.
  * Example: "Iran denies missile test" after earlier report -> SHORT signal may not last
  * Set holding_period_hours = 2, trading_type = "VOLATILE_EVENT"
- MEDIUM conviction (4-24 hour swing): Data-driven trading signal with clear catalyst but limited duration. Market volatility, earnings surprises, technical breaks.
  * Example: "Federal Reserve hints at rate cuts next month" -> impact may persist through trading session
  * Set holding_period_hours = 8-16, trading_type = "SWING"
- HIGH conviction (24+ hour thesis): Structural multi-day theme. Sustained policy change, war developments, earnings trends, sector rotation.
  * Example: "New crypto regulation passed Congress" or "Extended military conflict confirmed" -> impact persists for days
  * Set holding_period_hours = 48-168, trading_type = "POSITION"

Trading type selection:
- SCALP (1-2 hours): Use ONLY for high-volatility news spikes expected to reverse quickly
- SWING (4-24 hours): Default for news-driven trades, earnings, macro events
- POSITION (24-168 hours): Multi-day structural themes, sustained policy changes
- VOLATILE_EVENT (1-4 hours): Breaking news with uncertain duration or rapidly evolving situations

action_if_already_in_position guidance:
- If current signal matches existing trade direction: set to "HOLD" (let existing position run)
- If current signal opposes existing trade: set to "TAKE_PROFIT" for MEDIUM/LOW conviction or "EXIT" if waiting for reversal confirmation
- Only recommend "ADD" if conviction is HIGH and existing position has strong unrealized gains
"""


# ============================================================================
# CONTEXT-AWARE PROMPT WITH PRICE DATA
# Incorporates current market prices for better signal accuracy
# ============================================================================

CONTEXT_AWARE_PROMPT = """You are a geopolitical risk analyst with access to real-time market data, writing for a trader who wants a clear, shareable explanation.

Current Market Context:
- Date: {date}
- Active Symbol Analyst: {active_symbol}
- Active Symbol Price: ${active_symbol_price}
- USO (Oil ETF) Price: ${uso_price}
- BITO (Bitcoin Trust - Crypto ETF) Price: ${bito_price}
- QQQ (Nasdaq 100 ETF) Price: ${qqq_price}
- SPY (S&P 500 ETF) Price: ${spy_price}

Recent Market Sentiment: {recent_sentiment}

Structured Validation Context:
{validation_context}

Recent Web Research Context:
{web_research_context}

Text to analyze:
{text}

Return your analysis in this exact JSON format:
{{
  "market_bluster": {{
    "is_bluster": boolean,
    "bluster_score": float,
    "confidence": float,
    "reasoning": string
  }},
  "policy_change": {{
    "is_policy_change": boolean,
    "policy_score": float,
    "impact_severity": "low" | "medium" | "high",
    "confidence": float,
    "reasoning": string
  }},
  "trading_signal": {{
    "signal_type": "LONG" | "SHORT" | "HOLD",
    "confidence_score": float,  // confidence in analysis accuracy
    "conviction_level": "LOW" | "MEDIUM" | "HIGH",  // conviction in thesis
    "trading_type": "SCALP" | "SWING" | "POSITION" | "VOLATILE_EVENT",
    "holding_period_hours": int,  // 1-720 hours
    "action_if_already_in_position": "HOLD" | "EXIT" | "ADD" | "TAKE_PROFIT",
    "urgency": "LOW" | "MEDIUM" | "HIGH",
    "entry_symbol": "USO" | "BITO",
    "reasoning": string
  }},
  "price_correlation_analysis": string,  // How text relates to current price action
  "overall_assessment": string,
  "supporting_points": [string],  // 3-6 concrete observations from the text
  "headline_citations": [string],  // 2-5 short source-aware references like "BBC: Iran missile strike confirmed"
  "analyst_writeup": string,  // 120-220 words, plain English, explicitly explain WHY the signal is LONG/SHORT/HOLD using concrete items from the text
  "symbol_impacts": {{
    "USO": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }},
    "BITO": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }},
    "QQQ": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }},
    "SPY": {{
      "market_bluster": float,
      "policy_change": float,
      "confidence": float,
      "reasoning": string
    }}
  }}
}}

Consider the current market context when analyzing:
- If USO is at multi-month highs and text is hype -> likely bluster (sentiment already priced in)
- If BITO is rallying on negative news -> assess if substantive crypto regulation or emotional fear-driven
- If QQQ/SPY diverging from typical macro patterns -> check for factor-specific (crypto, tech regulation) vs broad market drivers
- If prices have recently moved sharply opposite to the headline sentiment -> possible reversal signal or market pricing in different fundamentals
- Cross-reference with recent sentiment trends: is this news contrary to recent sentiment (potential reversal) or confirming it (continuation)?

Write the analyst_writeup so it is useful to share with another person:
- mention the most important specific claims or headlines from the text
- separate rumor / rhetoric from confirmed policy action
- explain how those items connect to the signal
- if claims conflict, say so explicitly
- do not use vague filler like "aggregated across all analyzed sources"

For symbol_impacts:
- USO should reflect oil / energy / Middle East supply sensitivity (highly affected by geopolitical risk, sanctions, military action)
- BITO should reflect crypto risk appetite, liquidity, regulation, and macro fear (affected by crypto regulation, inflation, USD strength, regulatory crackdowns)
- QQQ should reflect large-cap tech / growth sensitivity to rates, war risk, risk appetite, and tech-specific regulation
- SPY should reflect broader equity / macro sensitivity to economic policy, war risk, and systemic risk
- CRITICAL: Do not copy the same reasoning into all four symbols - analyze the specific transmission mechanism for each
- Consider directional impact: "crypto_regulation" typically hurts BITO near-term but QQQ may benefit if it reduces regulatory uncertainty
- Military/geopolitical risk: typically helps USO (energy) and hurts QQQ/SPY (growth stocks), neutral to BITO unless tied to specific sanctions on crypto

SCORING CALIBRATION — READ CAREFULLY:
- Every symbol must receive DIFFERENT scores that reflect this specific news event's unique impact on that symbol's price drivers
- Do NOT output the same bluster_score and policy_score across multiple symbols — this is a sign of lazy analysis
- Avoid round numbers (0.5, 0.8, 0.3, 0.9) — use precise values like 0.43, 0.71, 0.28 that reflect actual reasoning
- Confidence should reflect genuine uncertainty: most analyses should be 0.55-0.78, NOT 0.90
- If news has weak signal-to-noise for a symbol, policy_score should be near 0.1-0.2 and confidence 0.45-0.60
- Only use confidence > 0.85 if there is direct, confirmed, actionable news for that exact symbol
"""


SYMBOL_SPECIALIST_APPENDIX = """

You are acting as a DEDICATED {symbol} SPECIALIST for this run.
This is a SINGLE-SYMBOL analysis. You are NOT analyzing a basket of symbols.

Specialist mandate:
{specialist_focus}

CRITICAL RULES FOR THIS ANALYSIS:
- You are ONLY analyzing for {symbol}, not for any other symbol
- Evaluate the headline specifically through the lens of how it affects {symbol}
- If this news would have different impacts on different symbols, explain WHY and focus on the {symbol} impact
- The signal (LONG/SHORT/HOLD) must reflect YOUR specialist view for {symbol}
- Do NOT try to evaluate USO, BITO, QQQ, SPY simultaneously
- Do NOT include a symbol_impacts dictionary - this is a single-symbol specialist run

Your response should be a SINGLE analysis for {symbol} ONLY:
"""


# ============================================================================
# SYMBOL-SPECIFIC SPECIALIST FOCUS AREAS
# Pre-defined guidance for each symbol's unique sensitivities
# ============================================================================

SYMBOL_SPECIALIST_FOCUS = {
    "USO": """
Focus on oil & energy supply dynamics. Key factors:
- Geopolitical risk in Middle East, Russia, or other key producing regions (supply concerns)
- OPEC+ production decisions and compliance
- US oil inventory data and refining capacity
- Sanctions or trade restrictions on oil exports
- Hurricane/weather disruptions to US production
- Global recession signals (demand destruction)
- Dollar strength (inverse to oil prices)

Validation guidance:
- Prefer consistently pullable official data from EIA Weekly Petroleum Status Report and EIA weekly inputs/utilization tables
- Treat refinery utilization, crude stocks, gasoline stocks, and distillate stocks as higher-quality confirmation than dramatic headlines alone
- If price is moving on geopolitical headlines but EIA refinery utilization is falling and inventories are building, be skeptical of the move
- Use crack-spread-style logic only as a secondary confirmation unless we have reliable upstream product price data
- Prefer official EIA data over media summaries when the two conflict
""",
    "BITO": """
Focus on cryptocurrency sentiment, regulation, and macro factors. Key factors:
- Crypto-specific regulatory announcements (SEC, CFTC, global)
- Bitcoin adoption by institutions or governments
- Inflation data and USD strength (affects crypto demand)
- Risk-on/risk-off market sentiment
- Liquidity events in crypto markets
- Mining difficulty/energy costs
- Federal Reserve policy shifts (affects all risk assets)

Validation guidance:
- Use US M2, not "Global M2", as the default liquidity proxy because US M2 is consistently pullable from FRED
- Prefer FRED M2SL and M2REAL as the macro liquidity baseline; treat them as slow-moving confirmation, not intraday timing signals
- Cross-check BTC/BITO moves against dollar strength and broad risk appetite when liquidity headlines are noisy
- Treat ETF/price action and USD conditions as practical confirmation when crypto-specific headline quality is weak
- Be cautious about claims that rely on custom "global liquidity" composites unless the source methodology is explicit and stable
""",
    "QQQ": """
Focus on large-cap tech, growth, and rate-sensitive factors. Key factors:
- Federal Reserve interest rate and inflation outlook
- Tech-sector specific regulations (antitrust, data privacy, AI)
- Earnings growth expectations for mega-cap tech
- Venture capital/startup funding environment
- Competition from international tech players
- Geopolitical risk to supply chains (semiconductors, China exposure)
- Valuation multiple compression from rate changes

Validation guidance:
- Prefer the US 10-Year TIPS real yield as the primary hard macro check for valuation pressure
- Use FRED DFII10 as the default real-yield source because it is consistently pullable and updated frequently
- TreasuryDirect TIPS auction results can be used as a secondary confirmation signal, not the primary daily series
- If QQQ is resilient while real yields are rising materially, treat that as potential valuation stretch unless earnings or AI-specific fundamentals clearly offset it
- Prefer real-yield data over generalized "rates are higher" headlines
""",
    "SPY": """
Focus on broad market macro drivers and risk sentiment. Key factors:
- Overall economic growth outlook
- Federal Reserve policy and interest rates
- Corporate earnings expectations
- Unemployment and labor market strength
- Geopolitical risks (war, sanctions, trade war)
- Credit spreads and systemic financial stress
- Risk-on/risk-off market rotation

Validation guidance:
- Prefer high-yield credit spreads as the primary systemic-risk confirmation signal
- Use FRED ICE BofA US High Yield OAS (BAMLH0A0HYM2) as the default spread source because it is consistently pullable
- Optionally compare against investment-grade OAS for context, but high-yield spreads should carry more weight for equity stress confirmation
- If SPY is strong while high-yield spreads are widening, treat the equity move with caution
- Prefer spread data over vague "risk-on" commentary when the two conflict
""",
}


SYMBOL_SPECIALIST_RESPONSE_PROMPT = """

REMEMBER: This is a SINGLE-SYMBOL specialist analysis for {symbol} ONLY.

YOUR ONLY JOB IS FACT EXTRACTION. Python will compute all numerical scores from your output.
Do NOT invent numbers — identify observable facts and phrases present in the text.

Return ONLY this JSON — nothing else:
{{
  "event_type": "geopolitical" | "regulatory" | "monetary_policy" | "fiscal" | "earnings" | "macro_data" | "sector_news" | "noise",
  "confirmed": boolean,
  "bluster_phrases": [string],
  "substance_phrases": [string],
  "symbol_relevance": {{
    "{symbol}": {{
      "relevant": boolean,
      "direction": "bullish" | "bearish" | "neutral",
      "mechanism": string
    }}
  }},
  "source_count": integer,
  "urgency": "LOW" | "MEDIUM" | "HIGH",
  "conviction": "LOW" | "MEDIUM" | "HIGH",
  "trading_type": "SCALP" | "SWING" | "POSITION" | "VOLATILE_EVENT",
  "holding_period_hours": integer,
  "analyst_writeup": string,
  "headline_citations": [string],
  "supporting_points": [string]
}}

Definitions:
- confirmed: true only if this is a completed, official action (signed, enacted, imposed, executed). Threats, warnings, negotiations, and speculation are false.
- bluster_phrases: rhetorical/speculative phrases found in the text such as "threatens to", "could possibly", "warns that", "may consider". List actual phrases from the text, up to 6.
- substance_phrases: concrete action/fact phrases found in the text such as "enacted sanctions", "signed executive order", "raised rates 25bps", "confirmed production cut". List actual phrases, up to 6.
- source_count: how many distinct news outlets appear in the text; estimate 2 if unclear.
- relevant: true only if this news has a plausible direct price mechanism for {symbol}. Unrelated-sector news with no transmission path should be false.
- mechanism: one sentence on WHY this moves {symbol}'s price. If not relevant write "No direct price mechanism."
- analyst_writeup: 100-200 words in plain English explaining what is happening and its specific impact on {symbol}.
"""


# ============================================================================
# PROMPT TEMPLATES
# Pre-formatted prompt templates for easy substitution
# ============================================================================

def format_bluster_prompt(text: str) -> str:
    """Format the market bluster detection prompt."""
    return MARKET_BLUSTER_PROMPT.replace("{text}", text)


def format_policy_prompt(text: str) -> str:
    """Format the policy change detection prompt."""
    return POLICY_CHANGE_PROMPT.replace("{text}", text)


def format_combined_prompt(text: str) -> str:
    """Format the combined analysis prompt."""
    return COMBINED_ANALYSIS_PROMPT.replace("{text}", text)


def get_symbol_specialist_focus(symbol: str) -> str:
    """
    Get the pre-defined specialist focus for a given symbol.
    
    Args:
        symbol: The stock symbol (e.g., 'USO', 'BITO', 'QQQ', 'SPY')
    
    Returns:
        The specialist focus description for that symbol
    """
    return SYMBOL_SPECIALIST_FOCUS.get(
        symbol.upper(),
        f"Analyze this news specifically for {symbol.upper()} trading signals."
    )


def format_context_aware_prompt(
    text: str,
    date: str = "",
    active_symbol: str = "",
    active_symbol_price: float = 0.0,
    uso_price: float = 0.0,
    bito_price: float = 0.0,
    qqq_price: float = 0.0,
    spy_price: float = 0.0,
    recent_sentiment: str = "",
    validation_context: str = "",
    web_research_context: str = "",
) -> str:
    """Format the context-aware prompt with market data."""
    result = CONTEXT_AWARE_PROMPT
    result = result.replace("{date}", date)
    result = result.replace("{active_symbol}", active_symbol or "UNKNOWN")
    result = result.replace("{active_symbol_price}", str(active_symbol_price))
    result = result.replace("{uso_price}", str(uso_price))
    result = result.replace("{bito_price}", str(bito_price))
    result = result.replace("{qqq_price}", str(qqq_price))
    result = result.replace("{spy_price}", str(spy_price))
    result = result.replace("{recent_sentiment}", recent_sentiment)
    result = result.replace("{validation_context}", validation_context or "No structured validation data available.")
    result = result.replace("{web_research_context}", web_research_context or "No recent web research context available.")
    result = result.replace("{text}", text)
    result = result.replace("{{", "{").replace("}}", "}")
    return result


def format_symbol_specialist_context_prompt(
    symbol: str,
    specialist_focus: str = "",
    text: str = "",
    date: str = "",
    active_symbol: str = "",
    active_symbol_price: float = 0.0,
    uso_price: float = 0.0,
    bito_price: float = 0.0,
    qqq_price: float = 0.0,
    spy_price: float = 0.0,
    recent_sentiment: str = "",
    validation_context: str = "",
    web_research_context: str = "",
) -> str:
    """Format the context-aware prompt with symbol-specialist guidance.
    
    If specialist_focus is not provided, it will be auto-loaded from SYMBOL_SPECIALIST_FOCUS.
    """
    # Auto-load specialist focus if not provided
    if not specialist_focus:
        specialist_focus = SYMBOL_SPECIALIST_FOCUS.get(
            symbol.upper(),
            f"Analyze this news specifically for {symbol} trading signals."
        )
    
    base = format_context_aware_prompt(
        text=text,
        date=date,
        active_symbol=active_symbol or symbol,
        active_symbol_price=active_symbol_price,
        uso_price=uso_price,
        bito_price=bito_price,
        qqq_price=qqq_price,
        spy_price=spy_price,
        recent_sentiment=recent_sentiment,
        validation_context=validation_context,
        web_research_context=web_research_context,
    )
    appendix = SYMBOL_SPECIALIST_APPENDIX.format(
        symbol=symbol,
        specialist_focus=specialist_focus,
    )
    specialist_schema = SYMBOL_SPECIALIST_RESPONSE_PROMPT.format(symbol=symbol)
    return f"{base}\n{appendix}\n{specialist_schema}"
