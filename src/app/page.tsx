'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  Menu, 
  ChevronRight, 
  ChevronDown,
  ExternalLink, 
  Settings,
  ChevronLeft,
  FolderPlus,
  RefreshCw,
  Rss,
  Loader2,
  GripVertical,
  Sun,
  Moon,
  List as ListIcon,
  LayoutList,
  LayoutGrid,
  Image as ImageIcon,
  Download,
  Upload,
  X,
  FileJson,
  Pencil,
  Bookmark,
  BookmarkCheck,
  BookmarkX,
  Star
} from 'lucide-react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Types ---
interface Folder {
  id: string;
  name: string;
}

type ViewMode = 'list' | 'magazine' | 'cards';

interface Feed {
  id: string;
  title: string;
  url: string;
  folderId?: string;
  icon?: string;
}

interface Article {
  title: string;
  link: string;
  pubDate: string;
  contentSnippet: string;
  content?: string;
  creator?: string;
  thumbnail?: string;
  feedTitle?: string;
}

interface BookmarkFolder {
  id: string;
  name: string;
}

interface SavedBookmark {
  id: string;
  article: Article;
  folderId?: string;
  savedAt: string;
}

const DEFAULT_FEEDS: Feed[] = [
  { id: '1', title: 'Yahoo! ニュース', url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml' },
  { id: '2', title: 'TechCrunch', url: 'https://techcrunch.com/feed/' }
];

// --- Sub-components ---

const ArticleThumbnail = ({ article, viewMode }: { article: Article, viewMode: ViewMode }) => {
  const [ogpThumb, setOgpThumb] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset state when article changes to prevent showing old image
  useEffect(() => {
    setOgpThumb(null);
  }, [article.link]);

  useEffect(() => {
    // Only fetch if no thumbnail is available in RSS data
    if (!article.thumbnail && !loading) {
      const fetchOgp = async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/ogp?url=${encodeURIComponent(article.link)}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.image) setOgpThumb(data.image);
        } catch (e) {
          console.error('Failed to fetch OGP:', e);
        } finally {
          setLoading(false);
        }
      };
      fetchOgp();
    }
  }, [article.link, article.thumbnail, loading]);

  const imageUrl = article.thumbnail || ogpThumb;

  if (imageUrl) {
    return (
      <div className={viewMode === 'magazine' ? 'w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-[var(--bg-sidebar)]' : 'w-full h-full'}>
        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div className={viewMode === 'magazine' ? 'w-20 h-20 shrink-0 rounded-lg bg-[var(--bg-sidebar)] flex items-center justify-center text-[var(--text-secondary)] opacity-10' : 'w-full h-full flex items-center justify-center text-[var(--text-secondary)] opacity-10'}>
      <ImageIcon className={viewMode === 'magazine' ? 'w-6 h-6' : 'w-12 h-12'} />
    </div>
  );
};

// --- Main Component ---

export default function RSSReader() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [activeView, setActiveView] = useState<{ type: 'feed' | 'folder' | 'bookmarks' | 'bookmark-folder', id?: string } | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedFolderId, setNewFeedFolderId] = useState<string>('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [viewMode, setViewMode] = useState<ViewMode>('magazine');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  // Bookmark state
  const [bookmarks, setBookmarks] = useState<SavedBookmark[]>([]);
  const [bookmarkFolders, setBookmarkFolders] = useState<BookmarkFolder[]>([]);
  const [expandedBookmarkFolders, setExpandedBookmarkFolders] = useState<Set<string>>(new Set());
  const [renameBookmarkFolderId, setRenameBookmarkFolderId] = useState<string | null>(null);
  const [renameBookmarkFolderName, setRenameBookmarkFolderName] = useState('');
  const [bookmarkFolderPickArticle, setBookmarkFolderPickArticle] = useState<Article | null>(null);
  // Read state
  const [readLinks, setReadLinks] = useState<Set<string>>(new Set());
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Responsive check
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize
  useEffect(() => {
    const savedFeeds = localStorage.getItem('rss-feeds');
    const savedFolders = localStorage.getItem('rss-folders');
    const savedTheme = localStorage.getItem('rss-theme') as 'light' | 'dark';
    const savedViewMode = localStorage.getItem('rss-view-mode') as ViewMode;

    if (savedFeeds) setFeeds(JSON.parse(savedFeeds));
    else {
      setFeeds(DEFAULT_FEEDS);
      localStorage.setItem('rss-feeds', JSON.stringify(DEFAULT_FEEDS));
    }

    if (savedFolders) {
      const parsed = JSON.parse(savedFolders);
      setFolders(parsed);
      // フォルダは初期状態で折りたたまれた状態を維持する
      setExpandedFolders(new Set());
    }
    
    if (savedTheme) setTheme(savedTheme);
    if (savedViewMode) setViewMode(savedViewMode);

    const savedBookmarks = localStorage.getItem('rss-bookmarks');
    const savedBmFolders = localStorage.getItem('rss-bookmark-folders');
    if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
    if (savedBmFolders) setBookmarkFolders(JSON.parse(savedBmFolders));
    const savedRead = localStorage.getItem('rss-read-links');
    if (savedRead) setReadLinks(new Set(JSON.parse(savedRead)));
  }, []);

  // Sync settings
  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('rss-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('rss-view-mode', viewMode);
  }, [viewMode]);

  // Fetch articles
  const refreshArticles = useCallback(async () => {
    if (!activeView) return;

    setLoading(true);
    setIsRefreshing(true);
    try {
      let urls: string[] = [];
      if (activeView.type === 'feed') {
        const feed = feeds.find(f => f.id === activeView.id);
        if (feed) urls = [feed.url];
      } else {
        urls = feeds.filter(f => f.folderId === activeView.id).map(f => f.url);
      }

      if (urls.length === 0) {
        setArticles([]);
        return;
      }

      const results = await Promise.all(
        urls.map(async (url) => {
          try {
            const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.items || []).map((item: any) => {
              let thumbnail = '';
              if (item.enclosure?.url) thumbnail = item.enclosure.url;
              else if (item['media:content']?.$.url) thumbnail = item['media:content'].$.url;
              else if (item['media:thumbnail']?.$.url) thumbnail = item['media:thumbnail'].$.url;
              else if (item['media:thumbnail']?.url) thumbnail = item['media:thumbnail'].url;
              else if (item.image) thumbnail = typeof item.image === 'string' ? item.image : item.image.url;
              
              const html = item['content:encoded'] || item.content || item.description || '';
              if (!thumbnail && html) {
                const match = html.match(/<img[^>]+src="([^">]+)"/);
                if (match) thumbnail = match[1];
              }
              return { ...item, thumbnail, feedTitle: data.title };
            });
          } catch (e) {
            console.error('Fetch error:', e);
            return [];
          }
        })
      );

      const allArticles = results.flat();
      allArticles.sort((a, b) => {
        const dateA = new Date(a.pubDate).getTime();
        const dateB = new Date(b.pubDate).getTime();
        return dateB - dateA; // Descending
      });

      setArticles(allArticles);
    } catch (e) {
      console.error(e);
      setArticles([]);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [feeds, activeView]);

  useEffect(() => {
    if (activeView?.type === 'bookmarks' || activeView?.type === 'bookmark-folder') {
      setArticles([]);
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [activeView]);

  useEffect(() => {
    refreshArticles();
    setSelectedArticle(null);
  }, [activeView, refreshArticles]);

  // Actions
  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');
  const toggleFolder = (id: string) => setExpandedFolders(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const addFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const n: Folder = { id: Date.now().toString(), name: newFolderName.trim() };
    const u = [...folders, n];
    setFolders(u);
    localStorage.setItem('rss-folders', JSON.stringify(u));
    setExpandedFolders(prev => new Set(prev).add(n.id));
    setNewFolderName('');
    setIsAddingFolder(false);
  };

  const renameFolder = (id: string, newName: string) => {
    if (!newName.trim()) {
      setRenameFolderId(null);
      return;
    }
    const u = folders.map(f => f.id === id ? { ...f, name: newName.trim() } : f);
    setFolders(u);
    localStorage.setItem('rss-folders', JSON.stringify(u));
    setRenameFolderId(null);
  };

  const openRenameDialog = (e: React.MouseEvent, folder: Folder) => {
    e.stopPropagation();
    e.preventDefault();
    setRenameFolderId(folder.id);
    setRenameFolderName(folder.name);
  };

  // Bookmark functions
  const isBookmarked = (link: string) => bookmarks.some(b => b.article.link === link);

  const addBookmark = (article: Article, folderId?: string) => {
    const bm: SavedBookmark = { id: Date.now().toString(), article, folderId, savedAt: new Date().toISOString() };
    const u = [...bookmarks, bm];
    setBookmarks(u);
    localStorage.setItem('rss-bookmarks', JSON.stringify(u));
    setBookmarkFolderPickArticle(null);
  };

  const removeBookmark = (link: string) => {
    const u = bookmarks.filter(b => b.article.link !== link);
    setBookmarks(u);
    localStorage.setItem('rss-bookmarks', JSON.stringify(u));
  };

  const addBookmarkFolder = () => {
    const name = window.prompt('ブックマークフォルダ名を入力してください:');
    if (!name?.trim()) return;
    const n: BookmarkFolder = { id: Date.now().toString(), name: name.trim() };
    const u = [...bookmarkFolders, n];
    setBookmarkFolders(u);
    localStorage.setItem('rss-bookmark-folders', JSON.stringify(u));
  };

  const deleteBookmarkFolder = (id: string) => {
    if (!window.confirm('フォルダを削除しますか？フォルダ内のブックマークは未分類に移動されます。')) return;
    const u = bookmarkFolders.filter(f => f.id !== id);
    setBookmarkFolders(u);
    localStorage.setItem('rss-bookmark-folders', JSON.stringify(u));
    const ub = bookmarks.map(b => b.folderId === id ? { ...b, folderId: undefined } : b);
    setBookmarks(ub);
    localStorage.setItem('rss-bookmarks', JSON.stringify(ub));
    if (activeView?.type === 'bookmark-folder' && activeView.id === id) setActiveView(null);
  };

  const renameBookmarkFolder = (id: string, newName: string) => {
    if (!newName.trim()) { setRenameBookmarkFolderId(null); return; }
    const u = bookmarkFolders.map(f => f.id === id ? { ...f, name: newName.trim() } : f);
    setBookmarkFolders(u);
    localStorage.setItem('rss-bookmark-folders', JSON.stringify(u));
    setRenameBookmarkFolderId(null);
  };

  const toggleBookmark = (article: Article) => {
    if (isBookmarked(article.link)) {
      removeBookmark(article.link);
    } else if (bookmarkFolders.length === 0) {
      addBookmark(article);
    } else {
      setBookmarkFolderPickArticle(article);
    }
  };

  const markAsRead = (link: string) => {
    if (readLinks.has(link)) return;
    const next = new Set(readLinks);
    next.add(link);
    setReadLinks(next);
    localStorage.setItem('rss-read-links', JSON.stringify(Array.from(next)));
  };

  const markAllAsRead = () => {
    const next = new Set(readLinks);
    articles.forEach(a => next.add(a.link));
    setReadLinks(next);
    localStorage.setItem('rss-read-links', JSON.stringify(Array.from(next)));
  };

  const getFilteredArticles = (arts: Article[]) => {
    if (readFilter === 'unread') return arts.filter(a => !readLinks.has(a.link));
    if (readFilter === 'read') return arts.filter(a => readLinks.has(a.link));
    return arts;
  };

  const deleteFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const u = folders.filter(f => f.id !== id);
    setFolders(u);
    localStorage.setItem('rss-folders', JSON.stringify(u));
    setFeeds(feeds.map(f => f.folderId === id ? { ...f, folderId: undefined } : f));
  };

  const deleteFeed = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const u = feeds.filter(f => f.id !== id);
    setFeeds(u);
    localStorage.setItem('rss-feeds', JSON.stringify(u));
    if (activeView?.id === id) setActiveView(null);
  };

  const addFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeedUrl.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(newFeedUrl)}`);
      if (!res.ok) throw new Error('Invalid RSS');
      const data = await res.json();
      const n: Feed = { id: Date.now().toString(), title: data.title || 'New Feed', url: newFeedUrl, folderId: newFeedFolderId || undefined };
      const u = [...feeds, n];
      setFeeds(u);
      localStorage.setItem('rss-feeds', JSON.stringify(u));
      setActiveView({ type: 'feed', id: n.id });
      setNewFeedUrl('');
    } catch (e) {
      alert('Error adding feed');
    } finally {
      setLoading(false);
    }
  };

  const escapeXml = (unsafe: string) => {
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  };

  const exportOPML = () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head>
    <title>RSS Reader Subscriptions</title>
  </head>
  <body>
${folders.map(folder => `    <outline text="${escapeXml(folder.name)}" title="${escapeXml(folder.name)}">
${feeds.filter(f => f.folderId === folder.id).map(feed => `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}" />`).join('\n')}
    </outline>`).join('\n')}
${feeds.filter(f => !f.folderId).map(feed => `    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}" />`).join('\n')}
  </body>
</opml>`;

    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rss-subscriptions-${format(new Date(), 'yyyyMMdd')}.opml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importOPML = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const text = await file.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      
      const newFolders: Folder[] = [...folders];
      const newFeeds: Feed[] = [...feeds];
      let addedCount = 0;
      
      const outlineNodes = xmlDoc.querySelectorAll('body > outline');
      outlineNodes.forEach(node => {
        if (node.getAttribute('type') === 'rss' || !node.children.length) {
          const title = node.getAttribute('title') || node.getAttribute('text') || 'Unknown Feed';
          const xmlUrl = node.getAttribute('xmlUrl');
          if (xmlUrl && !newFeeds.some(f => f.url === xmlUrl)) {
            newFeeds.push({ id: Date.now().toString() + Math.random().toString(), title, url: xmlUrl });
            addedCount++;
          }
        } else {
          const folderName = node.getAttribute('title') || node.getAttribute('text') || 'Imported Folder';
          let folderObj = newFolders.find(f => f.name === folderName);
          if (!folderObj) {
            folderObj = { id: Date.now().toString() + Math.random().toString(), name: folderName };
            newFolders.push(folderObj);
          }
          Array.from(node.children).forEach(child => {
            if (child.tagName === 'outline' && child.getAttribute('type') === 'rss') {
              const title = child.getAttribute('title') || child.getAttribute('text') || 'Unknown Feed';
              const xmlUrl = child.getAttribute('xmlUrl');
              if (xmlUrl && !newFeeds.some(f => f.url === xmlUrl)) {
                newFeeds.push({ id: Date.now().toString() + Math.random().toString(), title, url: xmlUrl, folderId: folderObj!.id });
                addedCount++;
              }
            }
          });
        }
      });

      setFolders(newFolders);
      setFeeds(newFeeds);
      localStorage.setItem('rss-folders', JSON.stringify(newFolders));
      localStorage.setItem('rss-feeds', JSON.stringify(newFeeds));
      alert(`${addedCount}件のフィードを読み込みました。`);
    } catch (err) {
      console.error(err);
      alert('OPMLファイルの読み込みに失敗しました。');
    } finally {
      setLoading(false);
      e.target.value = ''; // reset file input
    }
  };

  // Drag and Drop
  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    
    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    if (activeType === 'folder' && overType === 'folder') {
      setFolders(items => {
        const oldIdx = items.findIndex(i => i.id === active.id);
        const newIdx = items.findIndex(i => i.id === over.id);
        const res = arrayMove(items, oldIdx, newIdx);
        localStorage.setItem('rss-folders', JSON.stringify(res));
        return res;
      });
      return;
    }

    if (activeType === 'feed') {
      setFeeds(items => {
        const oldIdx = items.findIndex(i => i.id === active.id);
        let newIdx = items.findIndex(i => i.id === over.id);
        let targetFolderId = items[oldIdx].folderId;

        if (overType === 'folder') {
          targetFolderId = over.id as string;
          newIdx = items.length - 1; // フォルダにドロップした場合は末尾へ
        } else if (overType === 'feed') {
          const overFeed = items.find(i => i.id === over.id);
          targetFolderId = overFeed?.folderId;
        }

        const res = arrayMove(items, oldIdx, newIdx !== -1 ? newIdx : oldIdx).map(i => 
          i.id === active.id ? { ...i, folderId: targetFolderId } : i
        );
        localStorage.setItem('rss-feeds', JSON.stringify(res));
        return res;
      });
    }
  };

  // Renderers
  const SidebarFolder = ({ folder }: { folder: Folder }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
      id: folder.id,
      data: { type: 'folder', folder }
    });
    const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 40 : 'auto', opacity: isDragging ? 0.4 : 1 };

    return (
      <div ref={setNodeRef} style={style} className="mb-2">
        <div className={`flex items-center justify-between px-2 py-1.5 hover:bg-[var(--hover-color)] rounded-lg group cursor-pointer ${activeView?.type === 'folder' && activeView.id === folder.id ? 'bg-[var(--hover-color)] ring-1 ring-[var(--accent-color)]/30' : ''}`} onClick={() => { setActiveView({ type: 'folder', id: folder.id }); if (!expandedFolders.has(folder.id)) toggleFolder(folder.id); }}>
          <div className="flex items-center gap-2 text-[var(--text-primary)] overflow-hidden flex-1">
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-black/5 dark:hover:bg-white/5 rounded shrink-0">
              <GripVertical className="w-4 h-4 text-[var(--text-secondary)] opacity-50" />
            </div>
            <div onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id); }} className="p-0.5 hover:bg-black/5 dark:hover:bg-white/5 rounded shrink-0">
              {expandedFolders.has(folder.id) ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
            </div>
            {/* Folder name - no inline editing to avoid state conflicts */}
            <span className="text-xs font-bold uppercase tracking-wider truncate flex-1">{folder.name}</span>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => openRenameDialog(e, folder)}
              className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-secondary)] hover:text-[var(--accent-color)]"
              title="フォルダ名を変更"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => deleteFolder(folder.id, e)}
              className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-secondary)] hover:text-[#FF3B30]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {expandedFolders.has(folder.id) && (
          <div className="ml-6 mt-1 space-y-1">
            <SortableContext items={feeds.filter(f => f.folderId === folder.id).map(f => f.id)} strategy={verticalListSortingStrategy}>
              {feeds.filter(f => f.folderId === folder.id).map(f => <SidebarItem key={f.id} feed={f} isSelected={activeView?.type === 'feed' && activeView.id === f.id} />)}
            </SortableContext>
          </div>
        )}
      </div>
    );
  };

  const SidebarItem = ({ feed, isSelected }: { feed: Feed; isSelected: boolean }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ 
      id: feed.id,
      data: { type: 'feed', feed }
    });
    const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : 'auto', opacity: isDragging ? 0.3 : 1 };
    return (
      <div ref={setNodeRef} style={style} className="group relative">
        <button
          onClick={() => { setActiveView({ type: 'feed', id: feed.id }); if (isMobile) setIsSidebarOpen(false); }}
          className={`w-full flex items-center justify-between p-2 rounded-lg text-sm transition-all ${isSelected ? 'bg-[var(--accent-color)] text-white shadow-sm' : 'hover:bg-[var(--hover-color)] text-[var(--text-primary)]'}`}
        >
          <div className="flex items-center gap-2 flex-1 overflow-hidden">
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-black/5 dark:hover:bg-white/5 rounded">
              <GripVertical className={`w-3.5 h-3.5 ${isSelected ? 'text-white/70' : 'text-[var(--text-secondary)] opacity-50'}`} />
            </div>
            <span className="truncate flex-1 text-left">{feed.title}</span>
          </div>
          <Trash2 className={`w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'text-white' : 'text-[var(--text-secondary)] hover:text-[#FF3B30]'}`} onClick={e => deleteFeed(feed.id, e)} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full relative">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-20 w-64 bg-[var(--bg-sidebar)] border-r border-[var(--border-color)] transition-transform lg:relative lg:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex flex-col h-full">
          <div className="p-4 flex items-center justify-between">
            <h1 className="text-xl font-bold flex items-center gap-2 text-[var(--text-primary)]"><Rss className="w-5 h-5 text-[var(--accent-color)]" />RSS Reader</h1>
            <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 hover:bg-[var(--hover-color)] rounded-md text-[var(--text-secondary)] transition-colors" title="設定">
              <Settings className="w-5 h-5" />
            </button>
          </div>
          
          <div className="px-4 mb-4"><form onSubmit={addFeed} className="space-y-2"><div className="relative"><Plus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" /><input type="url" placeholder="フィードURLを追加" className="w-full pl-9 pr-4 py-2 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-xl text-sm outline-none" value={newFeedUrl} onChange={e => setNewFeedUrl(e.target.value)} /></div></form></div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {/* RSS Feeds section */}
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">フォルダ</span>
              <button onClick={() => setIsAddingFolder(true)} className="p-1 hover:bg-[var(--hover-color)] rounded text-[var(--text-secondary)]">
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>
            
            {isAddingFolder && (
              <form onSubmit={(e) => { addFolder(e); setIsAddingFolder(false); }} className="px-2 mb-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="フォルダ名"
                  className="w-full px-3 py-1.5 text-sm bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--accent-color)]"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onBlur={() => { if (!newFolderName) setIsAddingFolder(false); }}
                />
              </form>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <SortableContext items={folders.map(f => f.id)} strategy={verticalListSortingStrategy}>
                {folders.map(folder => (
                  <SidebarFolder key={folder.id} folder={folder} />
                ))}
              </SortableContext>
              
              <div className="mt-4">
                <div className="px-2 mb-1 flex items-center justify-between text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  <span>未分類</span>
                </div>
                <SortableContext items={feeds.filter(f => !f.folderId).map(f => f.id)} strategy={verticalListSortingStrategy}>
                  {feeds.filter(f => !f.folderId).map(f => (
                    <SidebarItem key={f.id} feed={f} isSelected={activeView?.type === 'feed' && activeView.id === f.id} />
                  ))}
                </SortableContext>
              </div>
            </DndContext>

            {/* Bookmark section */}
            <div className="mt-6 pt-4 border-t border-[var(--border-color)]">
              <div className="flex items-center justify-between px-2 mb-2">
                <button 
                  className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${activeView?.type === 'bookmarks' ? 'text-[var(--accent-color)]' : 'text-[var(--text-secondary)]'}`}
                  onClick={() => setActiveView({ type: 'bookmarks' })}
                >
                  <Star className="w-3.5 h-3.5" />
                  ブックマーク
                </button>
                <button onClick={addBookmarkFolder} className="p-1 hover:bg-[var(--hover-color)] rounded text-[var(--text-secondary)]" title="ブックマークフォルダを作成">
                  <FolderPlus className="w-4 h-4" />
                </button>
              </div>
              {bookmarkFolders.map(bf => (
                <div key={bf.id} className="mb-1">
                  <div className={`flex items-center justify-between px-2 py-1.5 hover:bg-[var(--hover-color)] rounded-lg group cursor-pointer ${activeView?.type === 'bookmark-folder' && activeView.id === bf.id ? 'bg-[var(--hover-color)] ring-1 ring-[var(--accent-color)]/30' : ''}`} onClick={() => { setActiveView({ type: 'bookmark-folder', id: bf.id }); setExpandedBookmarkFolders(p => { const n = new Set(p); n.has(bf.id) ? n.delete(bf.id) : n.add(bf.id); return n; }); }}>
                    <div className="flex items-center gap-2 text-[var(--text-primary)] overflow-hidden flex-1">
                      <div className="p-0.5 shrink-0">{expandedBookmarkFolders.has(bf.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                      <span className="text-xs font-bold uppercase tracking-wider truncate flex-1">{bf.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); setRenameBookmarkFolderId(bf.id); setRenameBookmarkFolderName(bf.name); }} className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-secondary)] hover:text-[var(--accent-color)]">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteBookmarkFolder(bf.id); }} className="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded text-[var(--text-secondary)] hover:text-[#FF3B30]">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {expandedBookmarkFolders.has(bf.id) && (
                    <div className="ml-6 mt-1 space-y-0.5">
                      {bookmarks.filter(b => b.folderId === bf.id).map(b => (
                        <button key={b.id} onClick={() => { setActiveView({ type: 'bookmark-folder', id: bf.id }); }} className="w-full text-left p-2 text-xs truncate hover:bg-[var(--hover-color)] rounded-lg text-[var(--text-secondary)]">{b.article.title}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {/* Uncategorized bookmarks */}
              {bookmarks.filter(b => !b.folderId).length > 0 && (
                <div 
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-color)] cursor-pointer ${activeView?.type === 'bookmarks' ? 'text-[var(--accent-color)]' : ''}`}
                  onClick={() => setActiveView({ type: 'bookmarks' })}
                >
                  未分類 ({bookmarks.filter(b => !b.folderId).length})
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[var(--bg-main)]">
        <header className="h-14 border-b border-[var(--border-color)] flex items-center justify-between px-4 sticky top-0 bg-[var(--bg-main)]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="lg:hidden p-1.5 hover:bg-[var(--hover-color)] rounded-md"><Menu className="w-5 h-5" /></button>
            {activeView?.type === 'bookmarks' ? (
              <h2 className="text-lg font-bold truncate max-w-[200px]">ブックマーク</h2>
            ) : activeView?.type === 'bookmark-folder' && activeView.id ? (
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-yellow-500" />
                <h2 className="text-lg font-bold truncate max-w-[200px]">{bookmarkFolders.find(f => f.id === activeView.id)?.name}</h2>
              </div>
            ) : activeView?.type === 'folder' && activeView.id ? (
              <div className="flex items-center gap-2 group">
                <h2 className="text-lg font-bold truncate max-w-[200px]">
                  {folders.find(f => f.id === activeView.id)?.name}
                </h2>
              </div>
            ) : (
              <h2 className="text-lg font-bold truncate max-w-[200px]">
                {activeView?.type === 'feed' ? feeds.find(f => f.id === activeView.id)?.title : '記事一覧'}
              </h2>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Read filter toggle */}
            <div className="flex items-center gap-0.5 bg-[var(--bg-sidebar)] p-1 rounded-lg mr-1 border border-[var(--border-color)] shadow-sm">
              {(['all', 'unread', 'read'] as const).map(f => (
                <button key={f} onClick={() => setReadFilter(f)} className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${readFilter === f ? 'bg-[var(--bg-main)] text-[var(--accent-color)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>
                  {f === 'all' ? 'すべて' : f === 'unread' ? '未読' : '既読'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 bg-[var(--bg-sidebar)] p-1 rounded-lg mr-2 border border-[var(--border-color)] shadow-sm">
              <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md ${viewMode === 'list' ? 'bg-[var(--bg-main)] text-[var(--accent-color)] shadow-sm' : 'text-[var(--text-secondary)]'}`} title="リスト表示"><ListIcon className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('magazine')} className={`p-1.5 rounded-md ${viewMode === 'magazine' ? 'bg-[var(--bg-main)] text-[var(--accent-color)] shadow-sm' : 'text-[var(--text-secondary)]'}`} title="マガジン表示"><LayoutList className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('cards')} className={`p-1.5 rounded-md ${viewMode === 'cards' ? 'bg-[var(--bg-main)] text-[var(--accent-color)] shadow-sm' : 'text-[var(--text-secondary)]'}`} title="カード表示"><LayoutGrid className="w-4 h-4" /></button>
            </div>
            <button onClick={refreshArticles} className="p-1.5 hover:bg-[var(--hover-color)] rounded-md text-[var(--text-secondary)]" title="更新"><RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
            {(activeView?.type === 'feed' || activeView?.type === 'folder') && articles.length > 0 && (
              <button onClick={markAllAsRead} className="text-[10px] px-2 py-1 rounded-md hover:bg-[var(--hover-color)] text-[var(--text-secondary)] whitespace-nowrap" title="すべて既読に">すべて既読</button>
            )}
          </div>
        </header>

        <div className={`flex-1 overflow-y-auto ${viewMode === 'cards' ? 'p-6' : ''}`}>
          {/* Bookmark views */}
          {(activeView?.type === 'bookmarks' || activeView?.type === 'bookmark-folder') ? (() => {
            const bms = activeView.type === 'bookmarks'
              ? bookmarks.filter(b => !b.folderId)
              : bookmarks.filter(b => b.folderId === activeView.id);
            if (bms.length === 0) return (
              <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)] opacity-50 gap-3">
                <Bookmark className="w-12 h-12" />
                <p>ブックマークがありません</p>
              </div>
            );
            return (
              <div className={viewMode === 'cards' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-7xl mx-auto' : 'flex flex-col'}>
                {bms.map((bm) => {
                  const article = bm.article;
                  const isSelected = selectedArticle?.link === article.link;
                  if (viewMode === 'list') return (
                    <div key={article.link} className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${isSelected ? 'bg-[var(--hover-color)] border-l-2 border-[var(--accent-color)]' : 'hover:bg-[var(--hover-color)]'}`}>
                      <button className="flex-1 flex items-center gap-3 min-w-0" onClick={() => setSelectedArticle(article)}>
                        <div className="flex flex-col w-20 shrink-0">
                          <span className="text-[10px] opacity-50">{article.pubDate ? format(new Date(article.pubDate), 'MM/dd HH:mm') : ''}</span>
                          <span className="text-[8px] font-bold uppercase tracking-tighter truncate text-[var(--accent-color)]">{article.feedTitle}</span>
                        </div>
                        <span className="text-sm truncate flex-1 font-medium">{article.title}</span>
                      </button>
                      <button onClick={() => removeBookmark(article.link)} className="p-1 text-yellow-500 hover:text-[var(--text-secondary)] shrink-0"><BookmarkX className="w-4 h-4" /></button>
                    </div>
                  );
                  if (viewMode === 'magazine') return (
                    <div key={article.link} className={`w-full text-left p-4 flex gap-4 transition-colors ${isSelected ? 'bg-[var(--hover-color)]' : 'hover:bg-[var(--hover-color)]'}`}>
                      <button className="flex-1 flex gap-4 min-w-0" onClick={() => setSelectedArticle(article)}>
                        <ArticleThumbnail article={article} viewMode={viewMode} />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] opacity-50">{article.pubDate ? format(new Date(article.pubDate), 'MM/dd HH:mm') : ''}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-color)]">{article.feedTitle}</span>
                          </div>
                          <h3 className="text-base font-bold line-clamp-2">{article.title}</h3>
                          <p className="text-xs opacity-60 line-clamp-2 mt-1">{article.contentSnippet}</p>
                        </div>
                      </button>
                      <button onClick={() => removeBookmark(article.link)} className="p-1 text-yellow-500 hover:text-[var(--text-secondary)] shrink-0 self-start"><BookmarkX className="w-4 h-4" /></button>
                    </div>
                  );
                  return (
                    <div key={article.link} className={`flex flex-col text-left bg-[var(--bg-main)] rounded-2xl overflow-hidden border border-[var(--border-color)] transition-all hover:shadow-xl relative ${isSelected ? 'ring-2 ring-[var(--accent-color)]' : ''}`}>
                      <button className="absolute top-2 right-2 z-10 p-1.5 bg-black/40 rounded-full text-yellow-400 hover:text-white" onClick={() => removeBookmark(article.link)}><BookmarkX className="w-4 h-4" /></button>
                      <button className="flex flex-col text-left flex-1" onClick={() => setSelectedArticle(article)}>
                        <div className="aspect-[16/9] w-full relative"><ArticleThumbnail article={article} viewMode={viewMode} /></div>
                        <div className="p-4 flex-1 flex flex-col"><h3 className="text-[15px] font-bold line-clamp-2 mb-2">{article.title}</h3><p className="text-xs opacity-60 line-clamp-2">{article.contentSnippet}</p></div>
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })() : loading && articles.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-secondary)]"><Loader2 className="w-6 h-6 animate-spin mr-2" /> 読み込み中...</div>
          ) : articles.length > 0 ? (
            <div className={viewMode === 'cards' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 max-w-7xl mx-auto' : 'flex flex-col'}>
              {getFilteredArticles(articles).map((article) => {
                const isSelected = selectedArticle?.link === article.link;
                if (viewMode === 'list') return (
                    <div key={article.link} className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${isSelected ? 'bg-[var(--hover-color)] border-l-2 border(--accent-color)]' : 'hover:bg-[var(--hover-color)]'} ${readLinks.has(article.link) ? 'opacity-60' : ''}`}>
                      <button className="flex-1 flex items-center gap-3 min-w-0" onClick={() => { setSelectedArticle(article); markAsRead(article.link); }}>
                        <div className="flex flex-col w-20 shrink-0">
                          <span className="text-[10px] opacity-50">{article.pubDate ? format(new Date(article.pubDate), 'MM/dd HH:mm') : ''}</span>
                          <span className="text-[8px] font-bold uppercase tracking-tighter truncate text-[var(--accent-color)]">{(article as any).feedTitle}</span>
                        </div>
                        <span className={`text-sm truncate flex-1 ${readLinks.has(article.link) ? 'font-normal' : 'font-bold'}`}>{!readLinks.has(article.link) && <span className="inline-block w-1.5 h-1.5 bg-[var(--accent-color)] rounded-full mr-1.5 shrink-0 align-middle" />}{article.title}</span>
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleBookmark(article); }} className={`p-1 shrink-0 ${isBookmarked(article.link) ? 'text-yellow-500' : 'text-[var(--text-secondary)] opacity-30 hover:opacity-100'}`}>
                        {isBookmarked(article.link) ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                if (viewMode === 'magazine') return (
                    <div key={article.link} className={`w-full text-left p-4 flex gap-4 transition-colors ${isSelected ? 'bg-[var(--hover-color)]' : 'hover:bg-[var(--hover-color)]'} ${readLinks.has(article.link) ? 'opacity-60' : ''}`}>
                      <button className="flex-1 flex gap-4 min-w-0" onClick={() => { setSelectedArticle(article); markAsRead(article.link); }}>
                        <ArticleThumbnail article={article} viewMode={viewMode} />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] opacity-50">{article.pubDate ? format(new Date(article.pubDate), 'MM/dd HH:mm') : ''}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-color)]">{(article as any).feedTitle}</span>
                          </div>
                          <h3 className={`text-base line-clamp-2 ${readLinks.has(article.link) ? 'font-normal' : 'font-bold'}`}>{!readLinks.has(article.link) && <span className="inline-block w-1.5 h-1.5 bg-[var(--accent-color)] rounded-full mr-1.5 shrink-0 align-middle" />}{article.title}</h3>
                          <p className="text-xs opacity-60 line-clamp-2 mt-1">{article.contentSnippet}</p>
                        </div>
                      </button>
                      <button onClick={e => { e.stopPropagation(); toggleBookmark(article); }} className={`p-1 shrink-0 self-start ${isBookmarked(article.link) ? 'text-yellow-500' : 'text-[var(--text-secondary)] opacity-30 hover:opacity-100'}`}>
                        {isBookmarked(article.link) ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                return (
                    <div key={article.link} className={`flex flex-col text-left bg-[var(--bg-main)] rounded-2xl overflow-hidden border border-[var(--border-color)] transition-all hover:shadow-xl relative ${isSelected ? 'ring-2 ring-[var(--accent-color)]' : ''} ${readLinks.has(article.link) ? 'opacity-60' : ''}`}>
                      {!readLinks.has(article.link) && <span className="absolute top-3 left-3 z-20 w-2 h-2 bg-[var(--accent-color)] rounded-full" />}
                      <button onClick={e => { e.stopPropagation(); toggleBookmark(article); }} className={`absolute top-2 right-2 z-10 p-1.5 bg-black/40 rounded-full ${isBookmarked(article.link) ? 'text-yellow-400' : 'text-white/50 hover:text-white'}`}>
                        {isBookmarked(article.link) ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                      <button className="flex flex-col text-left flex-1" onClick={() => { setSelectedArticle(article); markAsRead(article.link); }}>
                        <div className="aspect-[16/9] w-full relative"><ArticleThumbnail article={article} viewMode={viewMode} />
                          <div className="absolute top-3 left-3 flex flex-col gap-1">
                            <div className="px-2 py-0.5 bg-black/50 backdrop-blur-md rounded-full text-[10px] text-white uppercase font-bold">{article.pubDate ? format(new Date(article.pubDate), 'MM/dd HH:mm') : ''}</div>
                            <div className="px-2 py-0.5 bg-[var(--accent-color)]/80 backdrop-blur-md rounded-full text-[8px] text-white uppercase font-bold tracking-wider">{(article as any).feedTitle}</div>
                          </div>
                        </div>
                        <div className="p-4 flex-1 flex flex-col"><h3 className="text-[15px] font-bold line-clamp-2 mb-2">{article.title}</h3><p className="text-xs opacity-60 line-clamp-2">{article.contentSnippet}</p></div>
                      </button>
                    </div>
                  );
              })}
            </div>
          ) : <div className="flex items-center justify-center h-full text-[var(--text-secondary)] opacity-50">{activeView ? '記事がありません' : 'フィードまたはフォルダを選択してください'}</div>}
        </div>
      </main>

      {/* Article View (Overlay on mobile) */}
      <section className={`fixed inset-0 z-30 bg-[var(--bg-main)] transition-transform lg:relative lg:z-0 lg:flex-1 lg:border-l lg:border-[var(--border-color)] lg:translate-x-0 ${selectedArticle ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedArticle ? (
          <>
            <header className="h-14 border-b border-[var(--border-color)] flex items-center justify-between px-4 sticky top-0 bg-[var(--bg-main)]/80 backdrop-blur-md z-10">
              <button onClick={() => setSelectedArticle(null)} className="flex items-center gap-1 text-[var(--accent-color)] h-10 px-2 rounded-lg hover:bg-[var(--hover-color)]"><ChevronLeft className="w-5 h-5" /><span>一覧へ</span></button>
              <a href={selectedArticle.link} target="_blank" className="p-2 text-[var(--accent-color)] hover:bg-[var(--hover-color)] rounded-full"><ExternalLink className="w-5 h-5" /></a>
            </header>
            <article className="max-w-2xl mx-auto px-6 py-10">
              <header className="mb-8">
                <span className="text-sm opacity-50">{selectedArticle.pubDate ? format(new Date(selectedArticle.pubDate), 'yyyy年MM月dd日 HH:mm') : ''}</span>
                <h1 className="text-3xl font-extrabold mt-2 leading-tight">{selectedArticle.title}</h1>
              </header>
              <div 
                className={`prose ${theme === 'dark' ? 'prose-invert' : ''} max-w-none text-lg leading-relaxed`} 
                dangerouslySetInnerHTML={{ __html: selectedArticle.content || selectedArticle.contentSnippet || '' }} 
              />
              <div className="mt-12 pt-8 border-t border-[var(--border-color)]"><a href={selectedArticle.link} target="_blank" className="inline-flex w-full lg:w-auto px-8 py-4 bg-[var(--accent-color)] text-white font-bold rounded-full justify-center">記事の続きを読む</a></div>
            </article>
          </>
        ) : <div className="flex-1 flex items-center justify-center opacity-30 text-center h-full"><div><Rss className="w-12 h-12 mx-auto mb-4" /><p>記事を選択してください</p></div></div>}
      </section>
      
      {isSidebarOpen && isMobile && <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-10 lg:hidden" onClick={() => setIsSidebarOpen(false)} />}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-main)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-full border border-[var(--border-color)] relative">
            <header className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-[var(--accent-color)]" /> 設定</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-[var(--hover-color)] rounded-full text-[var(--text-secondary)]"><X className="w-5 h-5" /></button>
            </header>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {/* Theme Section */}
              <section>
                <h3 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">外観</h3>
                <div className="flex items-center justify-between p-4 bg-[var(--bg-sidebar)] rounded-xl border border-[var(--border-color)]">
                  <div className="flex items-center gap-3">
                    {theme === 'light' ? <Sun className="w-5 h-5 text-orange-500" /> : <Moon className="w-5 h-5 text-blue-400" />}
                    <div>
                      <div className="font-bold text-sm">テーマ</div>
                      <div className="text-xs text-[var(--text-secondary)]">{theme === 'light' ? 'ライトモード' : 'ダークモード'}</div>
                    </div>
                  </div>
                  <button 
                    onClick={toggleTheme}
                    className="px-4 py-2 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-sm font-medium hover:bg-[var(--hover-color)] transition-colors"
                  >
                    切り替え
                  </button>
                </div>
              </section>

              {/* Data Management Section */}
              <section>
                <h3 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">データ管理 (OPML)</h3>
                
                <div className="space-y-3">
                  <div className="p-4 bg-[var(--bg-sidebar)] rounded-xl border border-[var(--border-color)] space-y-3">
                    <div className="flex items-center gap-3 mb-2">
                      <FileJson className="w-5 h-5 text-[var(--accent-color)]" />
                      <div>
                        <div className="font-bold text-sm">バックアップと復元</div>
                        <div className="text-xs text-[var(--text-secondary)]">Feedlyや他のRSSリーダーと互換性のあるOPMLファイルで購読リストを書き出し・読み込みします。</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={exportOPML}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-sm font-medium hover:bg-[var(--hover-color)] transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        エクスポート
                      </button>
                      
                      <label className="flex items-center justify-center gap-2 px-4 py-2 bg-[var(--bg-main)] border border-[var(--border-color)] rounded-lg text-sm font-medium hover:bg-[var(--hover-color)] transition-colors cursor-pointer">
                        <Upload className="w-4 h-4" />
                        インポート
                        <input type="file" accept=".opml,.xml" className="hidden" onChange={importOPML} />
                      </label>
                    </div>
                    {/* Note: In this version it merges by default. */}
                    <p className="text-[10px] text-[var(--text-secondary)] text-center pb-1">※インポート時は現在のリストにマージされます</p>
                  </div>
                </div>
              </section>

            </div>
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {renameFolderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div
            className="bg-[var(--bg-main)] rounded-2xl shadow-2xl w-full max-w-sm border border-[var(--border-color)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4 text-[var(--text-primary)]">フォルダ名を変更</h2>
            <input
              autoFocus
              type="text"
              className="w-full px-4 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl outline-none focus:ring-2 focus:ring-[var(--accent-color)] mb-5 text-[var(--text-primary)]"
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameFolder(renameFolderId, renameFolderName);
                if (e.key === 'Escape') setRenameFolderId(null);
              }}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRenameFolderId(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-[var(--hover-color)] text-[var(--text-secondary)]"
              >
                キャンセル
              </button>
              <button
                onClick={() => renameFolder(renameFolderId, renameFolderName)}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--accent-color)] text-white hover:opacity-90"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bookmark Folder Pick Modal */}
      {bookmarkFolderPickArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-main)] rounded-2xl shadow-2xl w-full max-w-sm border border-[var(--border-color)] p-6">
            <h2 className="text-lg font-bold mb-1 text-[var(--text-primary)]">ブックマークに追加</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4">フォルダを選択してください</p>
            <div className="space-y-2 mb-5">
              <button onClick={() => addBookmark(bookmarkFolderPickArticle)} className="w-full text-left px-4 py-2 rounded-xl border border-[var(--border-color)] hover:bg-[var(--hover-color)] text-sm">未分類</button>
              {bookmarkFolders.map(f => (
                <button key={f.id} onClick={() => addBookmark(bookmarkFolderPickArticle, f.id)} className="w-full text-left px-4 py-2 rounded-xl border border-[var(--border-color)] hover:bg-[var(--hover-color)] text-sm">{f.name}</button>
              ))}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setBookmarkFolderPickArticle(null)} className="px-4 py-2 rounded-xl text-sm hover:bg-[var(--hover-color)] text-[var(--text-secondary)]">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Bookmark Folder Modal */}
      {renameBookmarkFolderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-main)] rounded-2xl shadow-2xl w-full max-w-sm border border-[var(--border-color)] p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4 text-[var(--text-primary)]">ブックマークフォルダ名を変更</h2>
            <input autoFocus type="text" className="w-full px-4 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl outline-none focus:ring-2 focus:ring-[var(--accent-color)] mb-5 text-[var(--text-primary)]" value={renameBookmarkFolderName} onChange={e => setRenameBookmarkFolderName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renameBookmarkFolder(renameBookmarkFolderId, renameBookmarkFolderName); if (e.key === 'Escape') setRenameBookmarkFolderId(null); }} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRenameBookmarkFolderId(null)} className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-[var(--hover-color)] text-[var(--text-secondary)]">キャンセル</button>
              <button onClick={() => renameBookmarkFolder(renameBookmarkFolderId, renameBookmarkFolderName)} className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--accent-color)] text-white hover:opacity-90">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
