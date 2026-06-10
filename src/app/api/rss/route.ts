import { NextRequest, NextResponse } from 'next/server';
import Parser from 'rss-parser';

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'media:content'],
      ['media:thumbnail', 'media:thumbnail'],
      ['content:encoded', 'content:encoded'],
      ['image', 'image'],
    ],
  }
});

// HTMLページから <link rel="alternate" type="application/rss+xml"> を探してフィードURLを自動発見する
async function discoverFeedUrl(siteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(siteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; rss-matome/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('html')) return null;
    const html = await res.text();

    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of linkTags) {
      if (!/rel=["']?alternate["']?/i.test(tag)) continue;
      if (!/type=["']?application\/(rss|atom)\+xml["']?/i.test(tag)) continue;
      const m = tag.match(/href=["']([^"']+)["']/i);
      if (m) return new URL(m[1], siteUrl).href; // 相対URLも絶対URLに解決
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const feedUrl = searchParams.get('url');

  if (!feedUrl) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  try {
    const feed = await parser.parseURL(feedUrl);
    return NextResponse.json(feed);
  } catch (error) {
    // RSSとして解析できない場合、HTMLページとみなしてフィードの自動発見を試みる
    const discovered = await discoverFeedUrl(feedUrl);
    if (discovered && discovered !== feedUrl) {
      try {
        const feed = await parser.parseURL(discovered);
        // 発見した実際のフィードURLをクライアントに返す (登録時はこちらを保存する)
        return NextResponse.json({ ...feed, feedUrl: discovered });
      } catch (e2) {
        console.error('RSS Parse Error (discovered):', e2);
      }
    }
    console.error('RSS Parse Error:', error);
    return NextResponse.json({ error: 'Failed to parse RSS feed' }, { status: 500 });
  }
}
