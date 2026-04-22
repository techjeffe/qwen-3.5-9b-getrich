"""
Truth Social Scraper using Playwright
Scrapes geopolitical and market-related posts from Truth Social
"""

import asyncio
import random
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from playwright.async_api import async_playwright, Page, BrowserContext

# Geopolitical keywords for filtering
GEOPOLITICAL_KEYWORDS = [
    "iran", "middle east", "war", "conflict", "sanctions", 
    "oil", "energy", "trump", "policy", "regulation",
    "market", "stocks", "economy", "inflation"
]


@dataclass
class TruthSocialPost:
    """Data class representing a scraped Truth Social post."""
    id: str
    content: str
    author: Optional[str]
    timestamp: datetime
    engagement: Dict[str, int]
    keywords_matched: List[str]


class TruthSocialScraper:
    """
    Async scraper for Truth Social using Playwright.
    
    Features:
    - Headless browser automation
    - Rate limiting with jitter
    - Keyword-based filtering
    - Error recovery with retries
    """
    
    def __init__(self, delay_range: tuple = (3, 5)):
        self.delay_range = delay_range
        self.browser = None
        self.context = None
        self.session = None
        
    async def __aenter__(self) -> "TruthSocialScraper":
        """Async context manager entry."""
        await self._init_browser()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self._close_browser()
    
    async def _init_browser(self) -> None:
        """Initialize Playwright browser."""
        self.browser = await async_playwright().start()
        self.context = await self.browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport={"width": 1920, "height": 1080},
            ignore_https_errors=True,
        )
        self.page = await self.context.new_page()
        
    async def _close_browser(self) -> None:
        """Close browser and cleanup."""
        if self.context:
            await self.context.close()
        if self.browser:
            await self.browser.stop()
    
    async def scrape_posts(
        self,
        query: str = "iran war market",
        limit: int = 50,
        max_retries: int = 3
    ) -> List[TruthSocialPost]:
        """
        Scrape Truth Social posts matching the query.
        
        Args:
            query: Search query for geopolitical/market content
            limit: Maximum number of posts to scrape
            max_retries: Maximum retry attempts per request
            
        Returns:
            List of scraped posts with metadata
        """
        posts = []
        retries = 0
        
        while len(posts) < limit and retries < max_retries:
            try:
                await self._scrape_with_delay()
                scraped = await self._extract_posts(query, limit - len(posts))
                posts.extend(scraped)
                
                if len(scraped) == 0:
                    break
                    
            except Exception as e:
                retries += 1
                print(f"Scrape attempt {retries} failed: {e}")
                if retries >= max_retries:
                    break
        
        return posts
    
    async def _scrape_with_delay(self) -> None:
        """Execute scrape with rate limiting and jitter."""
        delay = random.uniform(*self.delay_range)
        await asyncio.sleep(delay)
    
    async def _extract_posts(
        self,
        query: str,
        limit: int
    ) -> List[TruthSocialPost]:
        """
        Extract posts from the current page.
        
        In production, this would navigate to Truth Social and parse HTML.
        For now, returns mock data for testing.
        """
        # TODO: Implement actual scraping logic
        # This is a placeholder that simulates scraped data
        
        mock_posts = [
            {
                "id": f"ts_{i}",
                "content": f"Breaking: Major policy shift announced regarding {query}! Markets reacting strongly. #Iran #Oil",
                "author": "MarketWatcher",
                "timestamp": datetime.utcnow(),
                "engagement": {"likes": random.randint(10, 500), "comments": random.randint(5, 100)}
            }
            for i in range(min(limit, 5))
        ]
        
        posts = []
        for post_data in mock_posts:
            keywords_matched = [kw for kw in GEOPOLITICAL_KEYWORDS if kw.lower() in post_data["content"].lower()]
            
            post = TruthSocialPost(
                id=post_data["id"],
                content=post_data["content"],
                author=post_data["author"],
                timestamp=post_data["timestamp"],
                engagement=post_data["engagement"],
                keywords_matched=keywords_matched
            )
            posts.append(post)
        
        return posts
    
    def get_filtered_posts(
        self,
        all_posts: List[TruthSocialPost],
        min_keywords: int = 1
    ) -> List[TruthSocialPost]:
        """
        Filter posts by minimum keyword matches.
        
        Args:
            all_posts: All scraped posts
            min_keywords: Minimum number of geopolitical keywords to match
            
        Returns:
            Filtered list of relevant posts
        """
        return [
            post for post in all_posts
            if len(post.keywords_matched) >= min_keywords
        ]
