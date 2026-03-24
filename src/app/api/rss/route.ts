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
    console.error('RSS Parse Error:', error);
    return NextResponse.json({ error: 'Failed to parse RSS feed' }, { status: 500 });
  }
}
