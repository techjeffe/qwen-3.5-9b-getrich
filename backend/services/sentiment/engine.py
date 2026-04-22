"""
Sentiment Engine using Ollama Llama-3-70b
Analyzes geopolitical text for market bluster vs policy changes
"""

import os
import json
import time
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from pydantic import BaseModel, Field
import requests
import asyncio


@dataclass
class SentimentAnalysisResult:
    """Result of a single sentiment analysis."""
    text_source: str
    timestamp: datetime
    is_bluster: bool
    bluster_score: float
    bluster_indicators: List[str]
    is_policy_change: bool
    policy_score: float
    policy_indicators: List[str]
    impact_severity: str
    confidence: float
    reasoning: str


class SentimentAnalysisRequest(BaseModel):
    """Request model for sentiment analysis."""
    text: str = Field(..., min_length=10, max_length=5000)
    text_source: str = Field(default="")
    include_context: bool = Field(default=False)
    context_data: Optional[Dict[str, Any]] = Field(default=None)


class SentimentAnalysisResponse(BaseModel):
    """Response model for sentiment analysis."""
    request_id: str
    timestamp: datetime
    is_bluster: bool
    bluster_score: float
    bluster_indicators: List[str]
    is_policy_change: bool
    policy_score: float
    policy_indicators: List[str]
    impact_severity: str
    confidence: float
    reasoning: str
    directional_score: float = 0.0
    signal_type: str = "HOLD"
    urgency: str = "LOW"
    entry_symbol: str = ""
    analyst_writeup: str = ""
    supporting_points: List[str] = Field(default_factory=list)
    headline_citations: List[str] = Field(default_factory=list)
    symbol_impacts: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


class SentimentEngine:
    """
    Sentiment analysis engine using Ollama Llama-3-70b.
    
    Features:
    - Market bluster detection
    - Policy change identification
    - Trading signal generation
    - Caching for repeated analyses
    - Fallback handling
    """
    
    # Configuration — override with OLLAMA_MODEL and OLLAMA_URL env vars
    MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen3.5:9b")
    TEMPERATURE = 0.1
    MAX_TOKENS = 3072
    API_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
    
    # Caching
    _cache: Dict[str, SentimentAnalysisResponse] = {}
    _cache_ttl: int = 300  # 5 minutes
    
    def __init__(self, api_url: Optional[str] = None):
        """
        Initialize sentiment engine.
        
        Args:
            api_url: Ollama API URL (default: localhost:11434)
        """
        self.api_url = api_url or self.API_URL
        self.session = requests.Session()
        self._cache = {}
    
    def clear_cache(self):
        """Clear all cached analysis results."""
        self._cache = {}
    
    async def analyze(
        self,
        text: str,
        text_source: str = "",
        include_context: bool = False,
        context_data: Optional[Dict[str, Any]] = None,
        specialist_symbol: Optional[str] = None,
        specialist_focus: str = "",
    ) -> SentimentAnalysisResponse:
        """
        Analyze text for market bluster and policy changes.
        
        Args:
            text: Text to analyze (from social media or news)
            text_source: Source identifier for caching
            include_context: Whether to include market context
            context_data: Optional market data for context-aware analysis
            
        Returns:
            SentimentAnalysisResponse with bluster and policy scores
        """
        # Check cache first
        cache_key = f"{text_source}:{specialist_symbol or 'generic'}:{text[:100]}"
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if (datetime.utcnow() - cached.timestamp).total_seconds() < self._cache_ttl:
                return cached
        
        # Let exceptions propagate — callers must handle Ollama being unavailable
        if include_context and context_data:
            response = await self._analyze_with_context(
                text,
                text_source,
                context_data,
                specialist_symbol=specialist_symbol,
                specialist_focus=specialist_focus,
            )
        else:
            response = await self._analyze_text(text, text_source)

        self._cache[cache_key] = response
        return response
    
    async def _analyze_text(
        self,
        text: str,
        text_source: str
    ) -> SentimentAnalysisResponse:
        """Analyze text using combined prompt."""
        from .prompts import format_combined_prompt
        
        prompt = format_combined_prompt(text)
        
        response_data = await self._call_ollama(prompt)
        
        return self._parse_response(response_data, text_source)
    
    async def _analyze_with_context(
        self,
        text: str,
        text_source: str,
        context_data: Dict[str, Any],
        specialist_symbol: Optional[str] = None,
        specialist_focus: str = "",
    ) -> SentimentAnalysisResponse:
        """Analyze text with market context."""
        from .prompts import (
            format_context_aware_prompt,
            format_symbol_specialist_context_prompt,
        )
        
        # Format context data
        date = datetime.utcnow().strftime("%Y-%m-%d")
        active_symbol = specialist_symbol or str(context_data.get("active_symbol", "") or "")
        active_symbol_price = context_data.get("active_symbol_price", 0.0)
        uso_price = context_data.get("uso_price", 0.0)
        bito_price = context_data.get("bito_price", 0.0)
        qqq_price = context_data.get("qqq_price", 0.0)
        spy_price = context_data.get("spy_price", 0.0)
        recent_sentiment = context_data.get("recent_sentiment", "")
        validation_context = context_data.get("validation_context", "")
        
        if specialist_symbol:
            prompt = format_symbol_specialist_context_prompt(
                symbol=specialist_symbol,
                specialist_focus=specialist_focus,
                text=text,
                date=date,
                active_symbol=active_symbol,
                active_symbol_price=active_symbol_price,
                uso_price=uso_price,
                bito_price=bito_price,
                qqq_price=qqq_price,
                spy_price=spy_price,
                recent_sentiment=recent_sentiment,
                validation_context=validation_context,
            )
        else:
            prompt = format_context_aware_prompt(
                text=text,
                date=date,
                active_symbol=active_symbol,
                active_symbol_price=active_symbol_price,
                uso_price=uso_price,
                bito_price=bito_price,
                qqq_price=qqq_price,
                spy_price=spy_price,
                recent_sentiment=recent_sentiment,
                validation_context=validation_context,
            )
        
        response_data = await self._call_ollama(prompt)
        
        return self._parse_response(response_data, text_source)
    
    @staticmethod
    def _strip_thinking(text: str) -> str:
        """Remove <think>...</think> blocks emitted by Qwen3 models."""
        import re
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    async def _call_ollama(self, prompt: str) -> Dict[str, Any]:
        return await asyncio.to_thread(self._call_ollama_sync, prompt)

    def _call_ollama_sync(self, prompt: str) -> Dict[str, Any]:
        payload = {
            "model": self.MODEL_NAME,
            "prompt": prompt,
            "stream": False,
            "think": False,  # Disables Qwen3 thinking mode; response goes to "response" field
            "options": {
                "temperature": self.TEMPERATURE,
                "num_predict": self.MAX_TOKENS,
            }
        }
        
        start_time = time.time()
        
        try:
            response = self.session.post(
                self.api_url,
                json=payload,
                timeout=120  # 2 minute timeout for LLM
            )
            response.raise_for_status()
            
            result = response.json()
            latency = (time.time() - start_time) * 1000
            
            print(f"Ollama request completed in {latency:.1f}ms")
            
            return result
            
        except requests.exceptions.Timeout:
            raise Exception("Ollama API timeout")
        except requests.exceptions.ConnectionError:
            raise Exception("Cannot connect to Ollama. Is it running?")
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON response from Ollama: {e}")
        except Exception as e:
            raise Exception(f"Ollama API error: {e}")
    
    def _parse_response(
        self,
        ollama_response: Dict[str, Any],
        text_source: str
    ) -> SentimentAnalysisResponse:
        """
        Parse Ollama response into structured data.
        
        Args:
            ollama_response: Raw response from Ollama API
            text_source: Source identifier
            
        Returns:
            SentimentAnalysisResponse with parsed data
        """
        # Extract the JSON from the LLM response
        raw_text = ollama_response.get("response", "")
        raw_text = self._strip_thinking(raw_text)

        try:
            # Try to find JSON in the response
            json_start = raw_text.find("{")
            json_end = raw_text.rfind("}") + 1
            
            if json_start >= 0 and json_end > json_start:
                json_str = raw_text[json_start:json_end]
                data = json.loads(json_str)
            else:
                # Fallback: try parsing entire response
                data = json.loads(raw_text)
                
        except json.JSONDecodeError:
            raise ValueError(
                f"Model did not return valid JSON. Raw response:\n{raw_text[:500]}"
            )
        
        # Accept both nested basket-level JSON and flatter specialist JSON.
        bluster = data.get("market_bluster", {})
        policy = data.get("policy_change", {})
        signal = data.get("trading_signal", {})
        if not bluster and "bluster_score" in data:
            bluster = {
                "is_bluster": data.get("is_bluster", False),
                "bluster_score": data.get("bluster_score", 0.0),
                "confidence": data.get("confidence", 0.5),
                "reasoning": data.get("reasoning", ""),
            }
        if not policy and "policy_score" in data:
            policy = {
                "is_policy_change": data.get("is_policy_change", False),
                "policy_score": data.get("policy_score", 0.0),
                "impact_severity": data.get("impact_severity", "low"),
                "confidence": data.get("confidence", 0.5),
                "reasoning": data.get("reasoning", ""),
            }
        if not signal and "signal_type" in data:
            signal = {
                "signal_type": data.get("signal_type", "HOLD"),
                "confidence_score": data.get("confidence", 0.5),
                "urgency": data.get("urgency", "LOW"),
                "entry_symbol": data.get("entry_symbol", ""),
                "reasoning": data.get("reasoning", ""),
            }
        supporting_points = data.get("supporting_points", []) or []
        headline_citations = data.get("headline_citations", []) or []
        analyst_writeup = self._build_analyst_writeup(
            data=data,
            bluster=bluster,
            policy=policy,
            signal=signal,
            supporting_points=supporting_points,
            headline_citations=headline_citations,
        )
        directional_score = self._resolve_directional_score(
            data=data,
            signal=signal,
            policy=policy,
            bluster=bluster,
            reasoning=analyst_writeup,
        )
        
        return SentimentAnalysisResponse(
            request_id="",  # Would be generated by caller
            timestamp=datetime.utcnow(),
            is_bluster=bluster.get("is_bluster", False),
            bluster_score=float(bluster.get("bluster_score", 0.0)),
            bluster_indicators=bluster.get("bluster_indicators", []),
            is_policy_change=policy.get("is_policy_change", False),
            policy_score=float(policy.get("policy_score", 0.0)),
            policy_indicators=policy.get("policy_indicators", []),
            impact_severity=policy.get("impact_severity", "low"),
            confidence=float(bluster.get("confidence", 0.5) * 0.6 + policy.get("confidence", 0.5) * 0.4),
            reasoning=analyst_writeup,
            directional_score=directional_score,
            signal_type=str(signal.get("signal_type", "HOLD")).upper(),
            urgency=str(signal.get("urgency", "LOW")).upper(),
            entry_symbol=str(signal.get("entry_symbol", "")),
            analyst_writeup=analyst_writeup,
            supporting_points=supporting_points,
            headline_citations=headline_citations,
            symbol_impacts=data.get("symbol_impacts", {}) or {},
        )

    @staticmethod
    def _build_analyst_writeup(
        data: Dict[str, Any],
        bluster: Dict[str, Any],
        policy: Dict[str, Any],
        signal: Dict[str, Any],
        supporting_points: List[str],
        headline_citations: List[str],
    ) -> str:
        """Prefer the model's full analyst writeup, with a structured fallback."""
        analyst_writeup = (data.get("analyst_writeup") or "").strip()
        if analyst_writeup:
            return analyst_writeup

        parts: List[str] = []
        signal_type = signal.get("signal_type", "HOLD")
        signal_reason = (signal.get("reasoning") or "").strip()
        overall = (data.get("overall_assessment") or "").strip()
        bluster_reason = (bluster.get("reasoning") or "").strip()
        policy_reason = (policy.get("reasoning") or "").strip()

        if overall:
            parts.append(overall)
        if signal_reason:
            parts.append(f"Signal rationale: {signal_type} because {signal_reason}")
        if headline_citations:
            parts.append("Key items: " + "; ".join(headline_citations[:4]))
        if supporting_points:
            parts.append("Supporting evidence: " + "; ".join(supporting_points[:4]))
        if bluster_reason:
            parts.append(f"Bluster view: {bluster_reason}")
        if policy_reason:
            parts.append(f"Policy view: {policy_reason}")

        fallback = "\n\n".join(part for part in parts if part)
        return fallback or "The model did not provide a detailed writeup for this signal."

    @staticmethod
    def _resolve_directional_score(
        data: Dict[str, Any],
        signal: Dict[str, Any],
        policy: Dict[str, Any],
        bluster: Dict[str, Any],
        reasoning: str,
    ) -> float:
        """Use model-provided directional scoring when available, else infer a bounded fallback."""
        try:
            if "directional_score" in data and data.get("directional_score") is not None:
                return max(-1.0, min(1.0, float(data.get("directional_score"))))
        except (TypeError, ValueError):
            pass

        signal_type = str(signal.get("signal_type", "HOLD")).upper().strip()
        try:
            policy_score = max(0.0, min(1.0, float(policy.get("policy_score", 0.0))))
        except (TypeError, ValueError):
            policy_score = 0.0
        try:
            bluster_score = max(-1.0, min(1.0, float(bluster.get("bluster_score", 0.0))))
        except (TypeError, ValueError):
            bluster_score = 0.0

        if signal_type == "LONG":
            return min(1.0, max(0.15, policy_score))
        if signal_type == "SHORT":
            return max(-1.0, min(-0.15, -max(abs(bluster_score), policy_score)))

        lowered = (reasoning or "").lower()
        positive_hints = ["bullish", "beneficiary", "re-rate higher", "rally", "positive for"]
        negative_hints = ["bearish", "headwind", "sell-off", "negative for", "pressure on"]
        if any(token in lowered for token in positive_hints):
            return min(1.0, max(0.1, policy_score * 0.8))
        if any(token in lowered for token in negative_hints):
            return max(-1.0, min(-0.1, -max(abs(bluster_score), policy_score * 0.8)))
        return 0.0
    
    def get_cached_result(self, key: str) -> Optional[SentimentAnalysisResponse]:
        """Get a cached result by key."""
        if key in self._cache:
            cached = self._cache[key]
            if (datetime.utcnow() - cached.timestamp).total_seconds() < self._cache_ttl:
                return cached
            else:
                del self._cache[key]
        return None
