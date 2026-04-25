"""
RSS Feed Parser using BeautifulSoup4
Parses geopolitical news feeds for sentiment analysis
"""

import feedparser
import requests
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from bs4 import BeautifulSoup
import re
from urllib.parse import urlparse

from services.app_config import DEFAULT_RSS_FEEDS


@dataclass
class NewsArticle:
    """Data class representing a parsed news article."""
    title: str
    link: str
    source: str
    author: Optional[str]
    published_date: datetime
    summary: str
    content: str
    keywords: List[str]


class RSSFeedParser:
    """
    Parser for geopolitical news RSS feeds using BeautifulSoup.
    
    Supports:
    - Multiple feed sources (Reuters, AP News, NYT Business, etc.)
    - HTML content extraction
    - Keyword-based filtering
    - Date-based filtering
    """
    
    # Canonical built-in feeds come from app_config so the parser and settings stay aligned.
    GEOPOLITICAL_FEEDS = {
        feed["key"]: feed["url"]
        for feed in DEFAULT_RSS_FEEDS
    }
    
    # Keywords used to tag articles with chips in the UI (not used for routing)
    KEYWORDS = [
        "war", "conflict", "sanctions", "geopolitical",
        "oil", "energy", "crude", "opec",
        "crypto", "bitcoin", "blockchain",
        "fed", "federal reserve", "inflation", "rates",
        "trump", "tariff", "trade",
        "policy", "regulation",
        "market", "stocks", "economy", "recession",
    ]
    
    def __init__(
        self,
        timeout: int = 10,
        feeds: Optional[Dict[str, str]] = None,
        feed_labels: Optional[Dict[str, str]] = None,
    ):
        self.timeout = timeout
        self.session = requests.Session()
        self.feeds = dict(feeds or self.GEOPOLITICAL_FEEDS)
        self.feed_labels = {str(key): str(value).strip() for key, value in (feed_labels or {}).items() if str(value).strip()}
        
    def parse_feeds(
        self,
        feed_names: Optional[List[str]] = None,
        date_from: Optional[datetime] = None
    ) -> List[NewsArticle]:
        """
        Parse all configured RSS feeds.
        
        Args:
            feed_names: Optional list of specific feeds to parse
            date_from: Only include articles published after this date
            
        Returns:
            List of parsed news articles
        """
        articles = []
        
        # Select feeds to parse
        feeds_to_parse = feed_names or list(self.feeds.keys())

        for feed_name in feeds_to_parse:
            try:
                feed_url = self.feeds[feed_name]
                articles.extend(self._parse_single_feed(feed_url, date_from))
            except Exception as e:
                print(f"Error parsing {feed_name}: {e}")
        
        return articles
    
    def _parse_single_feed(
        self,
        feed_url: str,
        date_from: Optional[datetime] = None
    ) -> List[NewsArticle]:
        """Parse a single RSS feed."""
        articles = []
        
        try:
            # Fetch feed using requests (more reliable than feedparser for some feeds)
            response = self.session.get(feed_url, timeout=self.timeout)
            response.raise_for_status()
            
            # Parse with feedparser first to get structured data
            feed = feedparser.parse(response.text)
            
            for entry in feed.entries:
                article = self._extract_article(entry, feed_url)
                
                # Filter by date if specified
                if date_from and article.published_date < date_from:
                    continue
                
                articles.append(article)
                
        except requests.RequestException as e:
            print(f"Request error for {feed_url}: {e}")
        except Exception as e:
            print(f"Parse error for {feed_url}: {e}")
        
        return articles
    
    def _extract_article(
        self,
        entry: Dict[str, Any],
        feed_url: str
    ) -> NewsArticle:
        """Extract article data from feed entry."""
        # Extract title
        title = getattr(entry, 'title', '') or ''
        
        # Extract link
        link = getattr(entry, 'link', '') or ''
        
        # Extract source (from feed URL)
        source = self._get_source_name(feed_url)
        
        # Extract author
        author = getattr(entry, 'author', None) or getattr(entry, 'get_author', None)
        
        # Extract published date
        published_date = self._parse_date(getattr(entry, 'published_parsed', None))
        
        # Extract summary/description
        summary = getattr(entry, 'summary', '') or ''
        if not summary:
            summary = getattr(entry, 'description', '') or ''
        
        # Try to get full content from HTML
        content = self._extract_content_from_html(summary)
        
        # Extract keywords
        keywords = self._extract_keywords(title + " " + summary)
        
        return NewsArticle(
            title=title,
            link=link,
            source=source,
            author=author,
            published_date=published_date,
            summary=summary,
            content=content,
            keywords=keywords
        )
    
    def _get_source_name(self, feed_url: str) -> str:
        """Get human-readable source name from URL."""
        for name, url in self.feeds.items():
            if url == feed_url:
                return self.feed_labels.get(name) or name.replace("_", " ").title()
        host = (urlparse(feed_url).netloc or "unknown").replace("www.", "")
        return host.split(":")[0].title()
    
    def _parse_date(self, parsed_date: Optional[tuple]) -> datetime:
        """Parse date tuple to datetime object."""
        if parsed_date is None:
            return datetime.utcnow()
        
        try:
            dt = datetime(*parsed_date[:6])
            return dt
        except (TypeError, ValueError):
            return datetime.utcnow()
    
    def _extract_content_from_html(self, html: str) -> str:
        """Extract clean text from HTML content."""
        if not html:
            return ""
        
        soup = BeautifulSoup(html, 'html.parser')
        
        # Remove scripts and styles
        for tag in soup(['script', 'style']):
            tag.decompose()
        
        # Get text content
        text = soup.get_text(separator=' ', strip=True)
        
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)
        
        return text[:5000]
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract matching geopolitical keywords from text."""
        text_lower = text.lower()
        matched = []
        
        for keyword in self.KEYWORDS:
            if keyword in text_lower:
                matched.append(keyword)
        
        return list(set(matched))  # Remove duplicates
    
    def filter_by_keywords(
        self,
        articles: List[NewsArticle],
        min_keywords: int = 1
    ) -> List[NewsArticle]:
        """
        Filter articles by minimum keyword matches.
        
        Args:
            articles: All parsed articles
            min_keywords: Minimum number of keywords to match
            
        Returns:
            Filtered list of relevant articles
        """
        return [
            article for article in articles
            if len(article.keywords) >= min_keywords
        ]
    
    def get_latest_articles(
        self,
        limit: int = 50,
        date_from: Optional[datetime] = None
    ) -> List[NewsArticle]:
        """
        Get the most recent articles from all feeds.
        
        Args:
            limit: Maximum number of articles to return
            date_from: Only include articles after this date
            
        Returns:
            Sorted list of latest articles
        """
        all_articles = self.parse_feeds(date_from=date_from)
        
        # Sort by published date (newest first)
        all_articles.sort(
            key=lambda a: a.published_date,
            reverse=True
        )
        
        return all_articles[:limit]
