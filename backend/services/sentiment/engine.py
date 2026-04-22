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
    MAX_TOKENS = 2048
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
    
    async def analyze(
        self,
        text: str,
        text_source: str = "",
        include_context: bool = False,
        context_data: Optional[Dict[str, Any]] = None
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
        cache_key = f"{text_source}:{text[:100]}"  # Hash key based on source and text prefix
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if (datetime.utcnow() - cached.timestamp).total_seconds() < self._cache_ttl:
                return cached
        
        # Let exceptions propagate — callers must handle Ollama being unavailable
        if include_context and context_data:
            response = await self._analyze_with_context(text, text_source, context_data)
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
        context_data: Dict[str, Any]
    ) -> SentimentAnalysisResponse:
        """Analyze text with market context."""
        from .prompts import format_context_aware_prompt
        
        # Format context data
        date = datetime.utcnow().strftime("%Y-%m-%d")
        uso_price = context_data.get("uso_price", 0.0)
        bito_price = context_data.get("bito_price", 0.0)
        spy_price = context_data.get("spy_price", 0.0)
        recent_sentiment = context_data.get("recent_sentiment", "")
        
        prompt = format_context_aware_prompt(
            text=text,
            date=date,
            uso_price=uso_price,
            bito_price=bito_price,
            spy_price=spy_price,
            recent_sentiment=recent_sentiment
        )
        
        response_data = await self._call_ollama(prompt)
        
        return self._parse_response(response_data, text_source)
    
    @staticmethod
    def _strip_thinking(text: str) -> str:
        """Remove <think>...</think> blocks emitted by Qwen3 models."""
        import re
        return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    async def _call_ollama(self, prompt: str) -> Dict[str, Any]:
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
        
        # Extract fields from parsed data
        bluster = data.get("market_bluster", {})
        policy = data.get("policy_change", {})
        signal = data.get("trading_signal", {})
        
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
            reasoning=f"Bluster: {bluster.get('reasoning', '')}\nPolicy: {policy.get('reasoning', '')}"
        )
    
    def clear_cache(self) -> None:
        """Clear the analysis cache."""
        self._cache.clear()
    
    def get_cached_result(self, key: str) -> Optional[SentimentAnalysisResponse]:
        """Get a cached result by key."""
        if key in self._cache:
            cached = self._cache[key]
            if (datetime.utcnow() - cached.timestamp).total_seconds() < self._cache_ttl:
                return cached
            else:
                del self._cache[key]
        return None
