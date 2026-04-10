/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  addDoc, 
  deleteDoc,
  query, 
  where, 
  serverTimestamp,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  User,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { db, auth } from './firebase';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { 
  LayoutDashboard, 
  Vote, 
  BarChart3, 
  CheckCircle2, 
  Loader2, 
  Users,
  QrCode,
  Share2,
  Trophy,
  Trash2,
  LogOut,
  UserCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Progress } from '../components/ui/progress';
import { cn } from '../lib/utils';
import { QRCodeCanvas } from 'qrcode.react';
import { toast, Toaster } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

// --- Types ---

interface Question {
  id: string;
  text: string;
  options: string[];
  order: number;
}

interface VoteData {
  id: string;
  pollId: string;
  questionId: string;
  optionIndex: number;
  userId: string;
  timestamp: any;
}

// --- Constants ---

const POLL_ID = 'ai-experience-poll-v2';
const QUESTIONS: Omit<Question, 'id'>[] = [
  {
    text: "Are you using some kind of AI subscription in your personal life?",
    options: ["Yes", "No"],
    order: 1
  },
  {
    text: "Have you used AI tools for coding for more than just a one shot project?",
    options: ["Yes", "No"],
    order: 2
  },
  {
    text: "Do you use an AI assistant like OpenClaw?",
    options: ["Yes", "No"],
    order: 3
  }
];

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      console.error("Caught error:", e.error);
      setHasError(true);
      setError(e.error?.message || "An unexpected error occurred");
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-red-50 text-red-900">
        <Card className="w-full max-w-md border-red-200">
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => window.location.reload()} variant="destructive">Reload App</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('vote');
  const [votedQuestionIds, setVotedQuestionIds] = useState<Set<string>>(new Set());
  const [authError, setAuthError] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const appUrl = window.location.href;
  const isGoogleUser = user?.providerData.some(p => p.providerId === 'google.com');

  // 1. Auth & Initialization
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setAuthError(null);
      } else {
        try {
          await signInAnonymously(auth);
        } catch (err: any) {
          console.error("Auth error:", err);
          if (err.code === 'auth/admin-restricted-operation') {
            setAuthError("Anonymous Authentication is not enabled in the Firebase Console. Please enable it to allow voting.");
          } else {
            setAuthError(err.message);
          }
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Seed Data & Listeners
  useEffect(() => {
    if (!user) return;

    const seedData = async () => {
      const qSnap = await getDocs(collection(db, 'polls', POLL_ID, 'questions'));
      if (qSnap.empty) {
        const batch = writeBatch(db);
        const pollRef = doc(db, 'polls', POLL_ID);
        batch.set(pollRef, { title: "AI Experience Poll", active: true });
        
        QUESTIONS.forEach((q, i) => {
          const qRef = doc(collection(db, 'polls', POLL_ID, 'questions'));
          batch.set(qRef, { ...q, id: qRef.id });
        });
        
        await batch.commit();
      }
    };

    seedData().catch(console.error);

    // Listen to questions
    const unsubQuestions = onSnapshot(
      query(collection(db, 'polls', POLL_ID, 'questions'), where('order', '>=', 0)),
      (snap) => {
        const qs = snap.docs.map(d => ({ ...d.data(), id: d.id } as Question));
        setQuestions(qs.sort((a, b) => a.order - b.order));
        setLoading(false);
      },
      (err) => console.error("Questions listener error:", err)
    );

    // Listen to votes
    const unsubVotes = onSnapshot(
      query(collection(db, 'votes'), where('pollId', '==', POLL_ID)),
      (snap) => {
        const vs = snap.docs.map(d => ({ ...d.data(), id: d.id } as VoteData));
        setVotes(vs);
        
        // Track which questions the current user has voted on
        const userVotedIds = new Set(
          vs.filter(v => v.userId === user.uid).map(v => v.questionId)
        );
        setVotedQuestionIds(userVotedIds);
      },
      (err) => console.error("Votes listener error:", err)
    );

    return () => {
      unsubQuestions();
      unsubVotes();
    };
  }, [user]);

  const handleVote = async (questionId: string, optionIndex: number) => {
    if (!user) return;
    
    setVoteError(null);
    try {
      // Use a deterministic ID to allow easy "upsert" (one vote per user per question)
      const voteId = `${user.uid}_${questionId}`;
      await setDoc(doc(db, 'votes', voteId), {
        pollId: POLL_ID,
        questionId,
        optionIndex,
        userId: user.uid,
        timestamp: serverTimestamp()
      });
    } catch (err: any) {
      console.error("Vote error:", err);
      setVoteError("Failed to register vote. Please check your connection.");
      setTimeout(() => setVoteError(null), 3000);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Google Sign-in error:", err);
      setAuthError(err.message);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AI Engagement Poll',
          text: 'Join the live poll and share your AI experience!',
          url: appUrl,
        });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error("Share error:", err);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(appUrl);
        toast.success("Link copied to clipboard!");
      } catch (err) {
        console.error("Clipboard error:", err);
        toast.error("Failed to copy link.");
      }
    }
  };

  const handleResetPoll = async () => {
    if (!isGoogleUser) return;
    
    const confirmReset = window.confirm("Are you sure you want to delete ALL votes for this poll? This action cannot be undone.");
    if (!confirmReset) return;

    setIsResetting(true);
    try {
      const q = query(collection(db, 'votes'), where('pollId', '==', POLL_ID));
      const snapshot = await getDocs(q);
      
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      toast.success("Poll has been reset successfully!");
    } catch (err: any) {
      console.error("Reset error:", err);
      toast.error("Failed to reset poll. You might not have permission.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      window.location.reload();
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  const ShareActions = () => (
    <div className="flex gap-2">
      {isGoogleUser && (
        <Button 
          variant="destructive" 
          size="sm" 
          className="gap-2" 
          onClick={handleResetPoll}
          disabled={isResetting}
        >
          {isResetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Reset Poll
        </Button>
      )}
      <Dialog open={isQrOpen} onOpenChange={setIsQrOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
          <QrCode className="w-4 h-4" />
          Show QR
        </DialogTrigger>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-4xl font-black text-center tracking-tight">Scan to Join Live Poll</DialogTitle>
            <DialogDescription className="text-center text-xl mt-2">
              Point your camera at the code below to participate!
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-4 sm:p-12 bg-white rounded-[3rem] border-4 border-slate-100 shadow-2xl">
            <div className="bg-white p-8 rounded-3xl shadow-inner border-2 border-slate-50">
              <QRCodeCanvas 
                value={appUrl} 
                size={600}
                level="H"
                includeMargin={false}
                className="rounded-sm w-full max-w-[600px] h-auto"
              />
            </div>
            <div className="mt-10 w-full text-center">
              <p className="text-sm text-slate-400 font-mono break-all leading-relaxed bg-slate-50 p-5 rounded-2xl border border-slate-100 max-w-xl mx-auto">
                {appUrl}
              </p>
            </div>
          </div>
          <div className="flex justify-center gap-6 pt-4">
            <Button variant="outline" size="xl" onClick={handleShare} className="gap-3">
              <Share2 className="w-6 h-6" />
              Copy Link
            </Button>
            <Button size="xl" onClick={() => setIsQrOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
      
      <Button variant="outline" size="sm" className="gap-2" onClick={handleShare}>
        <Share2 className="w-4 h-4" />
        Share
      </Button>
    </div>
  );

  if (authError) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-4">
        <Card className="w-full max-w-md border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-800 flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Authentication Required
            </CardTitle>
            <CardDescription className="text-amber-700">
              {authError.includes('admin-restricted-operation') 
                ? "Anonymous voting is currently disabled in the project settings." 
                : authError}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-amber-600 space-y-4">
            <div className="bg-white/50 p-3 rounded-lg border border-amber-100">
              <p className="font-medium mb-1">Option 1: Sign in with Google</p>
              <p className="text-xs opacity-80 mb-3">Use your Google account to vote immediately.</p>
              <Button onClick={handleGoogleSignIn} className="w-full bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 gap-2">
                <Users className="w-4 h-4" />
                Sign in with Google
              </Button>
            </div>

            <div className="space-y-2">
              <p className="font-medium">Option 2: Enable Anonymous Auth (Admin only)</p>
              <ol className="list-decimal ml-4 space-y-1 text-xs">
                <li>Open the Firebase Console.</li>
                <li>Go to <b>Authentication</b> &gt; <b>Sign-in method</b>.</li>
                <li>Enable the <b>Anonymous</b> provider.</li>
              </ol>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={() => window.location.reload()} variant="ghost" className="w-full text-amber-700 hover:bg-amber-100">
              Retry Connection
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Loader2 className="w-12 h-12 text-blue-600" />
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Toaster position="top-center" richColors />
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-blue-600 p-2 rounded-lg">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-bold text-xl tracking-tight">AI Engagement Poll</h1>
            </div>
            
            <div className="flex items-center gap-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                <TabsList className="bg-slate-100">
                  <TabsTrigger value="vote" className="gap-2">
                    <Vote className="w-4 h-4" />
                    <span className="hidden sm:inline">Vote</span>
                  </TabsTrigger>
                  <TabsTrigger value="results" className="gap-2">
                    <BarChart3 className="w-4 h-4" />
                    <span className="hidden sm:inline">Results</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full border border-slate-200" />}>
                  {user?.photoURL ? (
                    <img src={user.photoURL} alt="Avatar" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <UserCircle className="w-5 h-5 text-slate-500" />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{user?.displayName || (user?.isAnonymous ? 'Anonymous User' : 'User')}</span>
                        <span className="text-xs text-slate-500 truncate">{user?.email || 'No email associated'}</span>
                      </div>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  {!isGoogleUser ? (
                    <DropdownMenuItem onClick={handleGoogleSignIn} className="gap-2 text-blue-600 focus:text-blue-700">
                      <Users className="w-4 h-4" />
                      Sign in with Google
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={handleSignOut} className="gap-2 text-red-600 focus:text-red-700">
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">
          <AnimatePresence mode="wait">
            {activeTab === 'vote' ? (
              <motion.div
                key="vote-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Have Your Say!</h2>
                    <p className="text-slate-500">Share your experience with AI tools and see how you compare to others.</p>
                  </div>
                  <ShareActions />
                </div>
                <AnimatePresence>
                  {voteError && (
                    <motion.p 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-red-500 text-sm font-bold text-center mb-4"
                    >
                      {voteError}
                    </motion.p>
                  )}
                </AnimatePresence>

                <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-1 max-w-2xl mx-auto">
                  {questions.map((q, idx) => {
                    const hasVoted = votedQuestionIds.has(q.id);
                    const userVote = votes.find(v => v.userId === user?.uid && v.questionId === q.id);
                    const selectedOptionIndex = userVote?.optionIndex;

                    return (
                      <Card key={q.id} className={cn(
                        "transition-all duration-300 overflow-hidden border-2",
                        hasVoted ? "border-green-100 bg-green-50/30" : "border-slate-200 hover:border-blue-200"
                      )}>
                        <CardHeader className="pb-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-1 rounded">
                              Question {idx + 1}
                            </span>
                            {hasVoted && (
                              <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                                <CheckCircle2 className="w-3 h-3" />
                                Voted
                              </span>
                            )}
                          </div>
                          <CardTitle className="text-xl leading-tight">{q.text}</CardTitle>
                        </CardHeader>
                        <CardContent className="grid gap-3">
                          {q.options.map((option, optIdx) => {
                            const isSelected = hasVoted && selectedOptionIndex === optIdx;
                            return (
                              <Button
                                key={optIdx}
                                variant={isSelected ? "default" : "outline"}
                                size="lg"
                                onClick={() => handleVote(q.id, optIdx)}
                                className={cn(
                                  "h-14 text-lg font-medium justify-start px-6 transition-all relative overflow-hidden",
                                  "hover:scale-[1.02] active:scale-[0.98]",
                                  isSelected && "bg-green-600 hover:bg-green-700 text-white border-green-600 opacity-100 shadow-md ring-2 ring-green-200 ring-offset-1",
                                  hasVoted && !isSelected && "opacity-60 border-slate-200"
                                )}
                              >
                                <span className={cn(
                                  "mr-4 w-6 h-6 rounded-full flex items-center justify-center text-sm transition-colors",
                                  isSelected ? "bg-white text-green-600 font-bold" : "bg-slate-100 text-slate-500"
                                )}>
                                  {isSelected ? <CheckCircle2 className="w-4 h-4" /> : String.fromCharCode(65 + optIdx)}
                                </span>
                                {option}
                                {isSelected && (
                                  <motion.div 
                                    initial={{ x: '100%' }}
                                    animate={{ x: '0%' }}
                                    className="absolute right-4 top-1/2 -translate-y-1/2"
                                  >
                                    <span className="text-[10px] font-black uppercase tracking-widest bg-white/20 px-2 py-1 rounded">Your Choice</span>
                                  </motion.div>
                                )}
                              </Button>
                            );
                          })}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {votedQuestionIds.size === questions.length && (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-center p-8 bg-blue-600 rounded-2xl text-white shadow-xl max-w-2xl mx-auto"
                  >
                    <Trophy className="w-12 h-12 mx-auto mb-4 text-yellow-300" />
                    <h3 className="text-2xl font-bold mb-2">All Done!</h3>
                    <p className="opacity-90 mb-6">Thank you for participating. Head over to the Results tab to see the live data.</p>
                    <Button 
                      variant="secondary" 
                      onClick={() => setActiveTab('results')}
                      className="bg-white text-blue-600 hover:bg-slate-100"
                    >
                      View Real-time Results
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="results-view"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-3xl font-extrabold text-slate-900">Live Insights</h2>
                    <p className="text-slate-500 flex items-center gap-2 mt-1">
                      <Users className="w-4 h-4" />
                      {new Set(votes.map(v => v.userId)).size} active participants
                    </p>
                  </div>
                  <ShareActions />
                </div>

                <div className="grid gap-8">
                  {questions.map((q, idx) => {
                    const questionVotes = votes.filter(v => v.questionId === q.id);
                    const totalVotes = questionVotes.length;
                    
                    const chartData = q.options.map((opt, optIdx) => {
                      const count = questionVotes.filter(v => v.optionIndex === optIdx).length;
                      const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                      return {
                        name: opt,
                        value: count,
                        percentage: percentage,
                        color: COLORS[optIdx % COLORS.length]
                      };
                    });

                    return (
                      <Card key={q.id} className="border-slate-200 shadow-sm overflow-hidden">
                        <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              Data Stream {idx + 1}
                            </span>
                          </div>
                          <CardTitle className="text-xl">{q.text}</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-8">
                          <div className="grid md:grid-cols-2 gap-8 items-center">
                            {/* Chart */}
                            <div className="h-[250px] w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 40 }}>
                                  <XAxis type="number" hide />
                                  <YAxis 
                                    dataKey="name" 
                                    type="category" 
                                    axisLine={false} 
                                    tickLine={false}
                                    width={60}
                                    tick={{ fontSize: 14, fontWeight: 500 }}
                                  />
                                  <Tooltip 
                                    cursor={{ fill: 'transparent' }}
                                    content={({ active, payload }) => {
                                      if (active && payload && payload.length) {
                                        return (
                                          <div className="bg-white p-2 shadow-lg border border-slate-100 rounded-lg text-sm">
                                            <p className="font-bold">{payload[0].payload.name}</p>
                                            <p className="text-slate-500">{payload[0].value} votes ({payload[0].payload.percentage}%)</p>
                                          </div>
                                        );
                                      }
                                      return null;
                                    }}
                                  />
                                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={40}>
                                    {chartData.map((entry, index) => (
                                      <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                  </Bar>
                                </BarChart>
                              </ResponsiveContainer>
                            </div>

                            {/* Stats List */}
                            <div className="space-y-6">
                              {chartData.map((data, i) => (
                                <div key={i} className="space-y-2">
                                  <div className="flex justify-between items-end">
                                    <span className="font-semibold text-slate-700">{data.name}</span>
                                    <span className="text-sm font-bold text-slate-900">
                                      {data.value} <span className="text-slate-400 font-normal">votes</span>
                                    </span>
                                  </div>
                                  <div className="relative h-3 w-full bg-slate-100 rounded-full overflow-hidden">
                                    <motion.div 
                                      initial={{ width: 0 }}
                                      animate={{ width: `${data.percentage}%` }}
                                      transition={{ duration: 1, ease: "easeOut" }}
                                      className="absolute top-0 left-0 h-full rounded-full"
                                      style={{ backgroundColor: data.color }}
                                    />
                                  </div>
                                  <div className="flex justify-end">
                                    <span className="text-xs font-bold text-slate-500">{data.percentage}%</span>
                                  </div>
                                </div>
                              ))}
                              <div className="pt-4 border-t border-slate-100 flex justify-between items-center text-slate-400 text-xs">
                                <span>Total Responses</span>
                                <span className="font-bold text-slate-600">{totalVotes}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="max-w-5xl mx-auto px-4 py-12 border-t border-slate-200 mt-12 text-center">
          <p className="text-slate-400 text-sm">
            &copy; 2026 AI Engagement Poll. Built for real-time audience interaction.
          </p>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
