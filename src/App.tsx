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
  Settings,
  Home,
  PlayCircle,
  Lock
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
  { id: 'gooaye_videos', handle: '@Gooaye', type: 'videos', shortName: '股癌 (影片)', name: '股癌 Gooaye (影片)' },
  { id: 'yutinghao_streams', handle: '@yutinghaofinance', type: 'streams', shortName: '游庭皓 (直播)', name: '游庭皓的財經皓角 (直播)' },
  { id: 's178_videos', handle: '@s178', type: 'videos', shortName: '郭哲榮 (影片)', name: '郭哲榮分析師-摩爾證券投顧 (影片)' },
  { id: 's178_streams', handle: '@s178', type: 'streams', shortName: '郭哲榮 (直播)', name: '郭哲榮分析師-摩爾證券投顧 (直播)' }
];

const APP_VERSION = 'Release 3.3.3';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('app_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState(false);

  const [activeTab, setActiveTab] = useState<'home' | 'settings'>('home');
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

  // Email states
  const [emails, setEmails] = useState<string[]>(() => {
    const saved = localStorage.getItem('gooaye_emails');
    if (saved) return JSON.parse(saved);
    return ['r76021061@gmail.com'];
  });
  const [newEmail, setNewEmail] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [showEmailModal, setShowEmailModal] = useState(false);

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
    if (showEmailModal || activeTab === 'settings') {
      checkEmailConfig();
    }
  }, [showEmailModal, activeTab]);

  const loadRecentVideos = async (offset: number = 0) => {
    setLoadingVideos(true);
    try {
      const res = await fetch(`/api/recent-videos?channel=${selectedChannel.handle}&type=${selectedChannel.type}`);
      const videos = await res.json();
      const count = 10;
      const slicedVideos = videos.slice(offset, offset + count);
      
      if (offset === 0) {
        setRecentVideos(slicedVideos);
      } else {
        setRecentVideos(prev => {
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
    setActiveTab('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    try {
      const result = await summarizeVideo(selectedChannel.name, finalUrl, videoInfo?.title);
      setSummary(result.text);
      setSources(result.sources);
      if (!targetUrl) setUrl('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || '分析過程中發生錯誤，請稍後再試。');
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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === '035553095') {
      localStorage.setItem('app_auth', 'true');
      setIsAuthenticated(true);
      setAuthError(false);
    } else {
      setAuthError(true);
      setPasswordInput('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans selection:bg-slate-200">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[3rem] p-8 sm:p-10 shadow-sm border-2 border-slate-200 w-full max-w-md text-center"
        >
          <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="w-12 h-12 text-blue-500" />
          </div>
          <h1 className="text-4xl font-extrabold text-slate-900 mb-4">專屬秘書</h1>
          <p className="text-2xl text-slate-500 mb-8 font-medium">請輸入通關密碼</p>
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <input
                type="tel"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  setAuthError(false);
                }}
                placeholder="請輸入密碼"
                className={cn(
                  "w-full text-center text-4xl py-6 rounded-2xl border-4 focus:outline-none transition-colors",
                  authError ? "border-red-400 bg-red-50 text-red-900" : "border-slate-200 focus:border-blue-500 bg-slate-50"
                )}
              />
              {authError && (
                <p className="text-red-500 text-xl font-bold mt-4">密碼錯誤，請再試一次！</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-6 rounded-[2rem] font-extrabold text-3xl shadow-xl shadow-blue-600/30 active:scale-95 transition-all"
            >
              進入系統
            </button>
          </form>
          
          <div className="mt-8 text-slate-400 font-mono text-sm">
            {APP_VERSION}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-56 font-sans selection:bg-slate-200">
      {/* App Header (Sticky) */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b-2 border-slate-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 h-20 flex items-center justify-between relative">
          <button 
            onClick={() => {
              setActiveTab('home');
              setSummary(null);
              setError(null);
            }}
            className="flex items-center gap-4 active:scale-95 transition-transform text-left"
          >
            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-md">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
            <h1 className="font-extrabold text-3xl tracking-tight text-slate-900">財經 AI 秘書</h1>
          </button>
          <div className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded-md hidden sm:block">
            {APP_VERSION.replace('Release ', 'v')}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-6 w-full">
        <AnimatePresence mode="wait">
          {activeTab === 'home' ? (
            <motion.div
              key="home"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Channel Selector - 2x2 Grid for Super Large Touch Targets */}
              {!summary && !loading && (
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-3 pl-2">請選擇要聽的頻道：</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {CHANNELS.map(channel => (
                      <button
                        key={channel.id}
                        onClick={() => {
                          setSelectedChannel(channel);
                          setSummary(null);
                        }}
                        className={cn(
                          "px-4 py-4 rounded-[1.5rem] text-2xl font-bold transition-all shadow-sm border-2",
                          selectedChannel.id === channel.id 
                            ? "bg-slate-900 text-white border-slate-900 shadow-lg" 
                            : "bg-white text-slate-700 border-slate-200 active:bg-slate-100"
                        )}
                      >
                        {channel.shortName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hero Action - Analyze Latest */}
              {!summary && !loading && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-sm border-2 border-slate-200 text-center"
                >
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Youtube className="w-8 h-8 text-red-500" />
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-2 leading-tight">最新一集出爐了嗎？</h2>
                  <p className="text-slate-500 text-xl sm:text-2xl mb-4 leading-relaxed font-medium">點擊下方按鈕，AI 會自動幫您聽完並整理出投資重點，不用自己花時間聽！</p>
                  <button
                    onClick={() => handleSummarize()}
                    disabled={loadingVideos}
                    className="w-full bg-red-600 text-white py-5 sm:py-6 rounded-[2rem] font-extrabold text-3xl shadow-2xl shadow-red-600/30 active:scale-95 transition-all flex flex-col sm:flex-row items-center justify-center gap-4"
                  >
                    {loadingVideos ? (
                      <><Loader2 className="w-10 h-10 animate-spin" /> 尋找影片中...</>
                    ) : (
                      <><PlayCircle className="w-10 h-10" /> 聽最新一集</>
                    )}
                  </button>
                </motion.div>
              )}

              {/* Loading State */}
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white rounded-[3rem] p-16 shadow-sm border-2 border-slate-200 text-center flex flex-col items-center justify-center space-y-10"
                >
                  <div className="relative">
                    <div className="w-32 h-32 border-[12px] border-slate-100 border-t-slate-900 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BarChart3 className="w-14 h-14 text-slate-900" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-3xl font-extrabold text-slate-900 mb-6">AI 正在努力聽影片...</h3>
                    <p className="text-slate-500 text-2xl font-bold animate-pulse">這可能需要 1~2 分鐘，請稍候</p>
                  </div>
                </motion.div>
              )}

              {/* Error State */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-50 border-4 border-red-200 rounded-[3rem] p-12 text-center"
                >
                  <p className="text-red-600 font-extrabold text-4xl mb-6">哎呀，出錯了</p>
                  <p className="text-red-500 text-2xl font-bold mb-10">{error}</p>
                  <button 
                    onClick={() => handleSummarize()}
                    className="bg-red-600 text-white w-full py-8 rounded-[2rem] font-extrabold text-3xl active:scale-95 transition-all"
                  >
                    再試一次
                  </button>
                </motion.div>
              )}

              {/* Summary Result */}
              {summary && !loading && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-10"
                >
                  {/* Big Send Action */}
                  <button
                    onClick={() => setShowEmailModal(true)}
                    className="w-full bg-blue-600 text-white py-10 rounded-[3rem] font-extrabold text-4xl shadow-2xl shadow-blue-600/30 active:scale-95 transition-all flex items-center justify-center gap-4"
                  >
                    <Mail className="w-12 h-12" /> 傳給家人
                  </button>

                  <div className="bg-white rounded-[3rem] shadow-sm border-2 border-slate-200 overflow-hidden">
                    <div className="bg-slate-900 p-8 text-white flex items-center justify-between">
                      <h3 className="text-3xl font-extrabold flex items-center gap-4">
                        <FileText className="w-10 h-10" /> 重點筆記
                      </h3>
                      <button
                        onClick={copyToClipboard}
                        className="p-4 bg-white/10 rounded-2xl hover:bg-white/20 active:scale-95 transition-all flex items-center gap-3"
                      >
                        {copied ? <><Check className="w-8 h-8 text-green-400" /><span className="text-2xl font-bold text-green-400">已複製</span></> : <><Copy className="w-8 h-8" /><span className="text-2xl font-bold">複製</span></>}
                      </button>
                    </div>
                    <div className="p-8 sm:p-12">
                      <div className="markdown-body">
                        <Markdown>{summary}</Markdown>
                      </div>
                    </div>
                  </div>

                  {/* Source Links */}
                  {sources.length > 0 && (
                    <div className="space-y-6 pt-8">
                      <h4 className="text-2xl font-bold text-slate-500 uppercase tracking-wider pl-4">來源影片</h4>
                      <div className="grid gap-6">
                        {sources.map((source, idx) => (
                          <a
                            key={idx}
                            href={source.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-white border-2 border-slate-200 rounded-[2.5rem] p-8 flex items-center justify-between active:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-center gap-6 overflow-hidden">
                              <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center flex-shrink-0">
                                <Youtube className="w-10 h-10 text-red-500" />
                              </div>
                              <div className="overflow-hidden">
                                <p className="font-extrabold text-slate-900 line-clamp-2 text-2xl mb-2">{source.title || '影片連結'}</p>
                                <p className="text-xl text-slate-400 truncate">{source.uri}</p>
                              </div>
                            </div>
                            <ExternalLink className="w-10 h-10 text-slate-300 flex-shrink-0 ml-4" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Recent Videos List (Vertical for mobile) */}
              {!summary && !loading && (
                <div className="pt-10">
                  <div className="flex items-center justify-between mb-8 pl-2">
                    <h3 className="text-3xl font-extrabold text-slate-900 flex items-center gap-4">
                      <History className="w-10 h-10 text-slate-400" /> 歷史集數
                    </h3>
                  </div>
                  
                  <div className="space-y-6">
                    {recentVideos.length > 0 ? (
                      recentVideos.map((video, idx) => (
                        <div
                          key={idx}
                          className="bg-white border-2 border-slate-200 rounded-[2.5rem] p-8 flex flex-col gap-6 active:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-start gap-5">
                            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center flex-shrink-0 mt-1">
                              <Youtube className="w-10 h-10 text-slate-400" />
                            </div>
                            <div className="flex-1">
                              <p className="font-extrabold text-slate-900 text-2xl line-clamp-2 leading-relaxed mb-3">{video.title}</p>
                              {video.date && <span className="text-xl font-bold text-slate-500">{video.date}</span>}
                            </div>
                          </div>
                          <button 
                            onClick={() => handleSummarize(undefined, video.url)}
                            className="w-full bg-slate-100 text-slate-800 py-6 rounded-[2rem] font-extrabold text-2xl active:bg-slate-200 transition-colors flex items-center justify-center gap-3"
                          >
                            <Search className="w-8 h-8" /> 分析這集
                          </button>
                        </div>
                      ))
                    ) : !loadingVideos && (
                      <div className="bg-white border-2 border-slate-200 rounded-[2.5rem] p-12 text-center text-slate-500 text-2xl font-bold">
                        暫無影片資訊
                      </div>
                    )}
                    
                    {loadingVideos && (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={`loading-${i}`} className="w-full h-48 bg-slate-200 rounded-[2.5rem] animate-pulse" />
                      ))
                    )}

                    {recentVideos.length > 0 && recentVideos.length < 50 && !loadingVideos && (
                      <button 
                        onClick={() => loadRecentVideos(recentVideos.length)}
                        className="w-full py-8 text-slate-500 font-extrabold text-2xl active:bg-slate-200 rounded-[2.5rem] transition-colors border-4 border-dashed border-slate-300 mt-6"
                      >
                        載入更多...
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-[3rem] shadow-sm border-2 border-slate-200 p-8">
                <div className="flex items-center gap-6 mb-8">
                  <div className="w-20 h-20 bg-blue-50 rounded-3xl flex items-center justify-center">
                    <Users className="w-10 h-10 text-blue-500" />
                  </div>
                  <div>
                    <h2 className="text-4xl font-extrabold text-slate-900 mb-2">收件人設定</h2>
                    <p className="text-2xl text-slate-500 font-medium">設定要收到筆記的信箱</p>
                  </div>
                </div>

                <div className="space-y-6 mb-12">
                  {emails.map((email, idx) => (
                    <div key={idx} className="flex items-center justify-between p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-100">
                      <span className="text-2xl font-bold text-slate-700 truncate pr-4">{email}</span>
                      <button 
                        onClick={() => removeEmail(email)} 
                        className="p-4 bg-white rounded-2xl text-red-500 shadow-sm border-2 border-slate-200 active:scale-95 transition-all flex-shrink-0"
                      >
                        <X className="w-8 h-8" />
                      </button>
                    </div>
                  ))}
                  {emails.length === 0 && (
                    <div className="text-center p-10 bg-slate-50 rounded-[2rem] border-4 border-slate-200 border-dashed text-slate-500 text-2xl font-bold">
                      目前沒有收件人，請在下方新增
                    </div>
                  )}
                </div>
                
                <div className="space-y-6">
                  <label className="block text-3xl font-extrabold text-slate-900">新增收件人</label>
                  <div className="flex flex-col gap-6">
                    <input 
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addEmail()}
                      placeholder="輸入 Email (如: 爸媽的信箱)"
                      className="w-full px-8 py-8 bg-slate-50 border-4 border-slate-200 rounded-[2rem] focus:ring-4 focus:ring-slate-900/20 focus:border-slate-900 outline-none transition-all text-3xl font-bold"
                    />
                    <button 
                      onClick={addEmail}
                      disabled={!newEmail.includes('@')}
                      className="w-full py-8 bg-slate-900 text-white rounded-[2rem] font-extrabold text-3xl active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-4"
                    >
                      <Plus className="w-10 h-10" /> 新增至清單
                    </button>
                  </div>
                </div>
              </div>

              {/* App Version Display */}
              <div className="mt-12 text-center pb-8">
                <p className="text-slate-400 text-lg font-bold">當前版本：{APP_VERSION}</p>
                <p className="text-slate-400 text-sm mt-2">財經 AI 秘書 © 2026</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation Bar (App-like) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t-4 border-slate-200 pb-safe z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="max-w-md mx-auto flex h-20">
          <button 
            onClick={() => {
              setActiveTab('home');
              setSummary(null);
              setError(null);
            }}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-3 transition-colors",
              activeTab === 'home' ? "text-slate-900" : "text-slate-400 active:bg-slate-50"
            )}
          >
            <Home className={cn("w-10 h-10", activeTab === 'home' && "fill-slate-900")} />
            <span className="text-xl font-extrabold">首頁</span>
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-3 transition-colors relative",
              activeTab === 'settings' ? "text-slate-900" : "text-slate-400 active:bg-slate-50"
            )}
          >
            <Users className={cn("w-10 h-10", activeTab === 'settings' && "fill-slate-900")} />
            <span className="text-xl font-extrabold">收件人</span>
            {emails.length > 0 && (
              <span className="absolute top-4 right-[30%] translate-x-6 w-8 h-8 bg-blue-500 text-white text-sm font-bold rounded-full flex items-center justify-center border-4 border-white">
                {emails.length}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* Send Email Bottom Sheet Modal */}
      <AnimatePresence>
        {showEmailModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEmailModal(false)}
              className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-[3rem] shadow-2xl max-h-[90vh] flex flex-col"
            >
              <div className="p-6 flex justify-center flex-shrink-0">
                <div className="w-24 h-3 bg-slate-200 rounded-full" />
              </div>
              
              <div className="px-10 pb-12 overflow-y-auto">
                <h3 className="text-4xl font-extrabold text-slate-900 mb-4">傳送筆記</h3>
                <p className="text-slate-500 mb-10 text-2xl font-bold">將這份筆記傳送給以下收件人：</p>
                
                <div className="space-y-8">
                  <div className="max-h-80 overflow-y-auto space-y-4 mb-8">
                    {emails.map((e, i) => (
                      <div key={i} className="flex items-center gap-5 text-2xl font-bold text-slate-700 bg-slate-50 p-6 rounded-[2rem] border-2 border-slate-100">
                        <Mail className="w-8 h-8 text-slate-400" /> {e}
                      </div>
                    ))}
                    {emails.length === 0 && (
                      <p className="text-red-500 text-2xl font-bold text-center p-8 bg-red-50 rounded-[2rem] border-4 border-red-100">請先到「收件人」設定新增信箱！</p>
                    )}
                  </div>

                  {emailError && (
                    <div className="p-6 bg-red-50 border-4 border-red-100 rounded-[2rem] text-2xl text-red-600 font-bold">
                      {emailError}
                    </div>
                  )}
                  
                  <button
                    onClick={handleSendEmail}
                    disabled={sendingEmail || emailSent || emails.length === 0}
                    className={cn(
                      "w-full py-8 rounded-[2.5rem] font-extrabold text-3xl flex items-center justify-center gap-4 transition-all active:scale-95",
                      emailSent ? "bg-green-500 text-white" : 
                      (emails.length === 0 ? "bg-slate-200 text-slate-400" : "bg-blue-600 text-white shadow-2xl shadow-blue-600/30")
                    )}
                  >
                    {sendingEmail ? (
                      <><Loader2 className="w-10 h-10 animate-spin" /> 傳送中...</>
                    ) : emailSent ? (
                      <><Check className="w-10 h-10" /> 已傳送！</>
                    ) : (
                      <><Send className="w-10 h-10" /> 確認傳送</>
                    )}
                  </button>
                  
                  <button 
                    onClick={() => setShowEmailModal(false)}
                    className="w-full py-6 text-2xl font-bold text-slate-500 active:bg-slate-50 rounded-[2rem] transition-colors mt-4"
                  >
                    取消
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
