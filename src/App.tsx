/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Youtube, 
  FileText, 
  Loader2, 
  Copy, 
  Check, 
  ExternalLink, 
  TrendingUp, 
  BarChart3, 
  MessageSquare,
  Mail,
  Send,
  History,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Users,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { summarizeVideo } from './services/gemini';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CHANNELS = [
  { id: '@Gooaye', name: '股癌 Gooaye' },
  { id: '@yutinghaofinance', name: '游庭皓的財經皓角' }
];

export default function App() {
  const [selectedChannel, setSelectedChannel] = useState(CHANNELS[0]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [sources, setSources] = useState<{ title?: string; uri?: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentVideoTitle, setCurrentVideoTitle] = useState<string | null>(null);
  
  // Recent videos
  const [recentVideos, setRecentVideos] = useState<{ title: string; url: string; date?: string }[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Email states
  const [emails, setEmails] = useState<string[]>(() => {
    const saved = localStorage.getItem('gooaye_emails');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Revert back to single email for testing
      if (parsed.includes('rose.huang@gmail.com')) {
        return ['r76021061@gmail.com'];
      }
      return parsed;
    }
    return ['r76021061@gmail.com'];
  });
  const [newEmail, setNewEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem('gooaye_emails', JSON.stringify(emails));
  }, [emails]);

  useEffect(() => {
    setRecentVideos([]);
    loadRecentVideos(0);
  }, [selectedChannel]);

  const checkEmailConfig = async () => {
    try {
      const res = await fetch('/api/email-status');
      const data = await res.json();
      setEmailConfigured(data.configured);
      setMissingKeys(data.missing || []);
    } catch (err) {
      console.error("Failed to check email config:", err);
    }
  };

  useEffect(() => {
    if (showEmailModal || showSettings) {
      checkEmailConfig();
    }
  }, [showEmailModal, showSettings]);

  // Auto-load more videos when scrolling to the end
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      // If we're within 100px of the end, load more
      if (scrollWidth - (scrollLeft + clientWidth) < 100 && !loadingVideos && recentVideos.length < 50) {
        loadRecentVideos(recentVideos.length);
      }
    }
  };

  const loadRecentVideos = async (offset: number = 0) => {
    setLoadingVideos(true);
    try {
      const res = await fetch(`/api/recent-videos?channel=${selectedChannel.id}`);
      const videos = await res.json();
      
      // Since the API returns all recent videos at once, we just slice it based on offset
      const count = 10;
      const slicedVideos = videos.slice(offset, offset + count);
      
      if (offset === 0) {
        setRecentVideos(slicedVideos);
      } else {
        setRecentVideos(prev => {
          // Prevent duplicates
          const newVideos = slicedVideos.filter((v: any) => !prev.some(p => p.url === v.url));
          return [...prev, ...newVideos];
        });
      }
    } catch (err) {
      console.error("Error loading videos:", err);
    } finally {
      setLoadingVideos(false);
    }
  };

  const handleSummarize = async (e?: React.FormEvent, targetUrl?: string) => {
    if (e) e.preventDefault();
    let finalUrl = targetUrl || url;
    
    // If no URL is provided, default to the latest video
    if (!finalUrl && recentVideos.length > 0) {
      finalUrl = recentVideos[0].url;
    }

    if (!finalUrl) {
      setError('請提供影片連結或等待最新影片載入。');
      return;
    }

    const videoInfo = recentVideos.find(v => v.url === finalUrl);
    setCurrentVideoTitle(videoInfo?.title || null);
    
    setLoading(true);
    setError(null);
    setSummary(null);
    setEmailSent(false);
    
    try {
      const result = await summarizeVideo(selectedChannel.name, finalUrl);
      setSummary(result.text);
      setSources(result.sources);
      if (!targetUrl) setUrl('');
    } catch (err) {
      console.error(err);
      setError('分析過程中發生錯誤，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!summary) return;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendEmail = async () => {
    if (!summary || emails.length === 0) return;
    setSendingEmail(true);
    setEmailError(null);
    
    let subject = `【${selectedChannel.name} 摘要】${new Date().toLocaleDateString()} 投資筆記`;
    if (currentVideoTitle) {
      subject = `【${selectedChannel.name} 摘要】${currentVideoTitle}`;
    } else if (sources.length > 0 && sources[0].title) {
      subject = `【${selectedChannel.name} 摘要】${sources[0].title}`;
    }

    try {
      // Send to all emails in the list
      const results = await Promise.all(emails.map(async (targetEmail) => {
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: targetEmail,
            subject: subject,
            body: summary
          })
        });
        return { ok: res.ok, email: targetEmail, status: res.status, data: await res.json().catch(() => ({})) };
      }));
      
      const failed = results.filter(r => !r.ok);
      if (failed.length === 0) {
        setEmailSent(true);
        setTimeout(() => {
          setEmailSent(false);
          setShowEmailModal(false);
        }, 3000);
      } else {
        const errorMsg = failed[0].data.error || '郵件寄送失敗，請檢查後台設定。';
        setEmailError(errorMsg);
      }
    } catch (err) {
      console.error(err);
      setEmailError('寄送郵件時發生網路錯誤。');
    } finally {
      setSendingEmail(false);
    }
  };

  const addEmail = () => {
    if (newEmail && !emails.includes(newEmail) && newEmail.includes('@')) {
      setEmails([...emails, newEmail]);
      setNewEmail('');
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter(e => e !== emailToRemove));
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const { scrollLeft, clientWidth } = scrollContainerRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - clientWidth : scrollLeft + clientWidth;
      scrollContainerRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-black/5 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">財經 AI 秘書</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-500">{emails.length} 位收件人</span>
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-400 hover:text-slate-900 transition-colors flex items-center gap-2"
              title="郵件設定"
            >
              <Settings className="w-5 h-5" />
              <span className="text-sm font-medium sm:hidden">設定</span>
            </button>
            <div className="hidden sm:flex items-center gap-6 text-sm font-medium text-slate-500 border-l border-black/5 pl-4">
              <a href={`https://www.youtube.com/${selectedChannel.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 flex items-center gap-1">
                <Youtube className="w-4 h-4" /> 前往頻道
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full">
        {/* Hero Section */}
        <section className="mb-8 text-center sm:text-left">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4 tracking-tight"
          >
            知名財經 YouTuber <span className="text-slate-400">AI 自動摘要</span>
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-500 max-w-2xl mb-6"
          >
            自動追蹤最新影片，利用 Gemini AI 進行專業財經摘要，過濾前段閒聊，直達投資重點。
          </motion.p>

          {/* Channel Selector */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="flex flex-wrap gap-2 mb-6"
          >
            {CHANNELS.map(channel => (
              <button
                key={channel.id}
                onClick={() => setSelectedChannel(channel)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-bold transition-all border",
                  selectedChannel.id === channel.id 
                    ? "bg-slate-900 text-white border-slate-900 shadow-md" 
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                )}
              >
                {channel.name}
              </button>
            ))}
          </motion.div>

          {/* Quick Email Management */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="flex flex-wrap items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-slate-400 uppercase tracking-wider mr-2">
              <Users className="w-4 h-4" /> 收件人:
            </div>
            {emails.map((email, idx) => (
              <div key={idx} className="flex items-center gap-1 px-3 py-1 bg-white rounded-full border border-slate-200 text-xs font-medium text-slate-600">
                {email}
                <button onClick={() => removeEmail(email)} className="hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 ml-auto w-full sm:w-auto mt-2 sm:mt-0">
              <input 
                type="email"
                placeholder="新增 Email (如: 爸、媽的)"
                className="flex-1 sm:w-48 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-slate-900"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addEmail()}
              />
              <button 
                onClick={addEmail}
                className="p-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
                title="新增收件人"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </section>

        {/* Recent Videos Carousel */}
        <section className="mb-12 relative">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <History className="w-4 h-4" /> 最近集數
            </h3>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => scroll('left')}
                className="p-1 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button 
                onClick={() => scroll('right')}
                className="p-1 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button 
                onClick={() => loadRecentVideos(0)}
                className="ml-2 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
              >
                重新整理
              </button>
            </div>
          </div>
          
          <div className="relative group">
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex overflow-x-auto pb-4 gap-4 scrollbar-hide snap-x scroll-smooth"
            >
              {recentVideos.length > 0 ? (
                recentVideos.map((video, idx) => (
                  <motion.button
                    key={idx}
                    whileHover={{ y: -4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleSummarize(undefined, video.url)}
                    className="flex-shrink-0 w-64 card p-4 text-left hover:border-slate-900 transition-all snap-start group/card"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center group-hover/card:bg-red-500 transition-colors">
                        <Youtube className="w-4 h-4 text-red-500 group-hover/card:text-white transition-colors" />
                      </div>
                      {video.date && <span className="text-[10px] font-bold text-slate-400">{video.date}</span>}
                    </div>
                    <p className="font-bold text-sm text-slate-900 line-clamp-2 mb-2 leading-snug">{video.title}</p>
                    <div className="flex items-center text-[10px] font-bold text-slate-400 group-hover/card:text-slate-900 transition-colors">
                      立即分析 <ChevronRight className="w-3 h-3 ml-1" />
                    </div>
                  </motion.button>
                ))
              ) : !loadingVideos && (
                <div className="w-full py-8 text-center text-slate-400 text-sm">暫無影片資訊</div>
              )}
              
              {loadingVideos && (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={`loading-${i}`} className="flex-shrink-0 w-64 h-32 bg-slate-200 rounded-2xl animate-pulse" />
                ))
              )}

              {recentVideos.length > 0 && recentVideos.length < 50 && !loadingVideos && (
                <div className="flex-shrink-0 w-12 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-slate-200 animate-spin" />
                </div>
              )}
            </div>
            
            {/* Scroll Indicators (Visual only for hint) */}
            <div className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-[#f5f5f5] to-transparent pointer-events-none" />
          </div>
        </section>

        {/* Input Section */}
        <section className="mb-12">
          <div className="card p-6 sm:p-8">
            <form onSubmit={handleSummarize} className="space-y-4">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Youtube className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  placeholder="輸入影片網址 (或從上方選擇集數)"
                  className="block w-full pl-11 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none text-slate-900"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      {url ? '分析此影片' : '分析最新影片'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 space-y-4"
            >
              <div className="relative">
                <div className="w-16 h-16 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-slate-900" />
                </div>
              </div>
              <p className="text-slate-500 font-medium animate-pulse">正在閱讀影片內容並整理摘要...</p>
            </motion.div>
          )}

          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="card border-red-100 bg-red-50 p-6 text-center"
            >
              <p className="text-red-600 font-medium">{error}</p>
              <button 
                onClick={() => handleSummarize()}
                className="mt-4 text-sm font-semibold text-red-700 underline underline-offset-4"
              >
                重試一次
              </button>
            </motion.div>
          )}

          {summary && !loading && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5" /> 分析結果
                </h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowEmailModal(true)}
                    className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    <Mail className="w-4 h-4" /> 寄送郵件
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 text-green-500" /> 已複製
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> 複製摘要
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="card p-6 sm:p-10">
                <div className="markdown-body">
                  <Markdown>{summary}</Markdown>
                </div>
              </div>

              {sources.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">參考來源</h4>
                  <div className="grid gap-3">
                    {sources.map((source, idx) => (
                      <a
                        key={idx}
                        href={source.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="card p-4 flex items-center justify-between hover:bg-slate-50 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center group-hover:bg-white transition-colors">
                            <Youtube className="w-5 h-5 text-slate-500" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 line-clamp-1">{source.title || '影片連結'}</p>
                            <p className="text-xs text-slate-400 truncate max-w-[200px] sm:max-w-md">{source.uri}</p>
                          </div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-slate-300 group-hover:text-slate-900 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Features Grid */}
        {!summary && !loading && (
          <section className="grid sm:grid-cols-3 gap-6 mt-12">
            <div className="card p-6">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                <MessageSquare className="w-5 h-5 text-slate-600" />
              </div>
              <h4 className="font-bold text-slate-900 mb-2">過濾閒聊</h4>
              <p className="text-sm text-slate-500">自動跳過前段的生活瑣事與五星吹捧，直達財經重點。</p>
            </div>
            <div className="card p-6">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 className="w-5 h-5 text-slate-600" />
              </div>
              <h4 className="font-bold text-slate-900 mb-2">產業展望</h4>
              <p className="text-sm text-slate-500">精準擷取對半導體、AI、電動車等各大產業的最新看法。</p>
            </div>
            <div className="card p-6">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mb-4">
                <TrendingUp className="w-5 h-5 text-slate-600" />
              </div>
              <h4 className="font-bold text-slate-900 mb-2">標的評論</h4>
              <p className="text-sm text-slate-500">整理對具體個股的評論與邏輯，幫助你快速掌握投資脈絡。</p>
            </div>
          </section>
        )}
      </main>

      {/* Email Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-8"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-slate-900">郵件設定</h3>
                <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-900">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">收件人清單</label>
                  <div className="space-y-2 mb-4">
                    {emails.map((email, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-sm font-medium text-slate-700">{email}</span>
                        <button onClick={() => removeEmail(email)} className="text-slate-400 hover:text-red-500 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex gap-2">
                    <input 
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addEmail()}
                      placeholder="新增 Email (如: 爸、媽的)"
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
                    />
                    <button 
                      onClick={addEmail}
                      className="p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all"
                    >
                      <Plus className="w-6 h-6" />
                    </button>
                  </div>
                </div>
                
                <p className="text-xs text-slate-400">設定將儲存在瀏覽器中，下次開啟時會自動載入。</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Send Email Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEmailModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-8"
            >
              <h3 className="text-2xl font-bold text-slate-900 mb-2">寄送摘要筆記</h3>
              <p className="text-slate-500 mb-6 text-sm">將這份 AI 摘要寄送到以下收件人：</p>
              
              <div className="space-y-4">
                {emailConfigured === false && (
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl mb-4">
                    <p className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1">
                      ⚠️ 尚未設定郵件伺服器 (SMTP)
                    </p>
                    <p className="text-[10px] text-amber-700 leading-relaxed mb-2">
                      請在 AI Studio 的「Secrets」面板中設定以下環境變數：
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {missingKeys.map(key => (
                        <span key={key} className="px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded text-[9px] font-mono font-bold">
                          {key}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="max-h-32 overflow-y-auto space-y-2 mb-4 pr-2">
                  {emails.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 p-2 rounded-lg">
                      <Users className="w-4 h-4" /> {e}
                    </div>
                  ))}
                  {emails.length === 0 && (
                    <p className="text-red-500 text-sm font-medium">請先在設定中新增收件人！</p>
                  )}
                </div>

                {emailError && (
                  <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">
                    {emailError}
                  </div>
                )}
                
                <button
                  onClick={handleSendEmail}
                  disabled={sendingEmail || emailSent || emails.length === 0 || emailConfigured === false}
                  className={cn(
                    "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all",
                    emailSent ? "bg-green-500 text-white" : 
                    (emailConfigured === false ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800")
                  )}
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      寄送中...
                    </>
                  ) : emailSent ? (
                    <>
                      <Check className="w-5 h-5" />
                      已寄出！
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      立即寄送至 {emails.length} 位收件人
                    </>
                  )}
                </button>
                
                <button 
                  onClick={() => setShowEmailModal(false)}
                  className="w-full py-2 text-sm font-medium text-slate-400 hover:text-slate-600 transition-colors"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="py-12 border-t border-black/5 text-center">
        <p className="text-sm text-slate-400">
          Powered by Gemini AI & Google Search Grounding
        </p>
      </footer>
    </div>
  );
}
