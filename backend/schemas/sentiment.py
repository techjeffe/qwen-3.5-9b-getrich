"""
Pydantic schemas for sentiment analysis results
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class SentimentAnalysisResult(BaseModel):
    """
    Raw sentiment analysis result from the LLM engine.
    Contains detailed breakdown of bluster vs policy change detection.
    """
    text_source: str = Field(
        default="",
        description="Source of the analyzed text (e.g., 'truth_social_post_123')"
    )
    timestamp: Optional[datetime] = Field(
        default=None,
        description="Timestamp of the source content"
    )
    
    # Market Bluster Analysis
    is_bluster: bool = Field(
        default=False,
        description="Whether the text represents market bluster (hype without substance)"
    )
    bluster_score: float = Field(
        default=0.0,
        ge=-1.0,
        le=1.0,
        description="Bluster intensity score (-1 to +1)"
    )
    bluster_indicators: List[str] = Field(
        default_factory=list,
        description="Keywords/phrases indicating bluster"
    )
    
    # Policy Change Analysis
    is_policy_change: bool = Field(
        default=False,
        description="Whether the text indicates a policy change"
    )
    policy_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Policy change intensity score (0 to +1)"
    )
    policy_indicators: List[str] = Field(
        default_factory=list,
        description="Keywords/phrases indicating policy changes"
    )
    impact_severity: str = Field(
        default="low",
        pattern=r"^(low|medium|high)$",
        description="Severity of potential market impact"
    )
    
    # Confidence metrics
    confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Overall analysis confidence"
    )
    reasoning: str = Field(
        default="",
        description="LLM's reasoning for the classification"
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "text_source": "truth_social_post_456",
                "timestamp": "2024-01-15T09:30:00Z",
                "is_bluster": True,
                "bluster_score": -0.75,
                "bluster_indicators": ["hype", "explosion", "skyrocket"],
                "is_policy_change": False,
                "policy_score": 0.0,
                "policy_indicators": [],
                "impact_severity": "medium",
                "confidence": 0.89,
                "reasoning": "Text contains multiple hype indicators without substantive policy language"
            }
        }
    }


class SentimentAggregation(BaseModel):
    """
    Aggregated sentiment across multiple sources.
    Used for computing overall market sentiment.
    """
    total_analyses: int = Field(default=0)
    
    # Average scores
    avg_bluster_score: float = Field(default=0.0)
    avg_policy_score: float = Field(default=0.0)
    avg_confidence: float = Field(default=0.0)
    
    # Counts
    bluster_count: int = Field(default=0)
    policy_change_count: int = Field(default=0)
    neutral_count: int = Field(default=0)
    
    # Severity breakdown
    high_impact_count: int = Field(default=0)
    medium_impact_count: int = Field(default=0)
    low_impact_count: int = Field(default=0)
