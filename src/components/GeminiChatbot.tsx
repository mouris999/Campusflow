import React, { useState, useRef, useEffect } from 'react';
import { secureWrite } from '../lib/api.js';
import {
  MessageSquare,
  Send,
  Bot,
  User,
  Sparkles,
  RefreshCw,
  Trash2,
  ChevronDown,
  Info,
  Clock,
  HelpCircle,
  FileText,
  Coffee,
  X,
  Minimize2,
  Maximize2
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

const CHAT_ROLES = [
  {
    id: 'concierge',
    name: 'Campus Concierge',
    icon: Sparkles,
    description: 'General services, directions, wait times & operating hours',
    instruction: `You are CampusFlow AI, the official intelligent assistant for Galgotias University, Greater Noida.
You help students, faculty, and campus visitors navigate services, virtual queues, operating hours, and university facilities.
Your knowledge includes:
- Administrative Offices: Student Records & Registrar (Main Admin Bld Floor 1), North Annex Registrar (North Pavilion - lower wait!), Bursar & Financial Aid (Main Admin Floor 2).
- Canteens & Dining: Student Union Central Canteen (peak lunch rush 11:30-13:30), Engineering Pavilion Cafe & Deli (fast grab-and-go with low wait).
- Laboratories: Chemistry & Biology Central Store (dispensing glassware/reagents, PPE required), Engineering Maker Lab & Workshop (oscilloscopes, 3D printing).
- Libraries: Central Library (circulation desk, course reserves 2-hour loan, study room keys).
- IT Support: Student Union Suite 205 (wifi setup, eduroam, laptop diagnostics, MFA reset).
- Virtual Queue Rules: Students can join remotely from anywhere on campus, receive dynamic ticket numbers (e.g. REG-103), receive alert when #2 in line, and have a 5-minute grace period when called to check in at the counter.
The campus is real Galgotias University, drawn from OpenStreetMap survey data. The building names above are CampusFlow service locations projected onto that campus until an administrator confirms the surveyed building; only B-Block, C-Block, School of Hospitality, Sports Ground and BasketBall Ground have surveyed positions. Never invent a building name, a room number or a distance - say it is not recorded instead.
Always be welcoming, structured, concise, and helpful. Use bullet points for steps or required documents.`
  },
  {
    id: 'records',
    name: 'Academic & Records Advisor',
    icon: FileText,
    description: 'Transcripts, enrollment verification, IDs & document policies',
    instruction: `You are the Academic Records & Registrar Specialist for Galgotias University.
You guide students on official transcripts, diploma orders, FERPA releases, major declarations, and campus ID card replacements.
Explain document requirements clearly in bullet points:
- Official Transcripts require Student ID or Govt Photo ID + FERPA clearance.
- ID Replacement requires $15 replacement receipt or proof of theft/loss report.
- North Annex Registrar offers express document stamping with much shorter waiting times than the Main Admin office.`
  },
  {
    id: 'dining',
    name: 'Dining & Queue Guide',
    icon: Coffee,
    description: 'Canteen wait times, meal rush alerts & express alternatives',
    instruction: `You are the Campus Dining & Congestion Advisor for Galgotias University.
Your goal is to save students time during meal peaks:
- Central Canteen gets severely congested between 11:30 AM and 1:30 PM (wait times exceed 20-30 minutes).
- Engineering Pavilion Cafe & Deli has light traffic (wait times ~3-5 minutes) with express grab-and-go options.
- Advise students to join the virtual pickup queue 15 minutes before their lecture ends.`
  }
];

const PROMPT_SUGGESTIONS = [
  'Where can I get my student ID card replaced today?',
  'Is the Central Canteen congested right now? What are the alternatives?',
  'What documents are required for official transcript verification?',
  'How does the 5-minute grace period work in the virtual queue?'
];

interface GeminiChatbotProps {
  isModal?: boolean;
  onClose?: () => void;
}

export const GeminiChatbot: React.FC<GeminiChatbotProps> = ({ isModal = false, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      text: "👋 Hello! I'm **CampusFlow AI**, powered by Google Gemini. How can I help you navigate campus services, virtual queues, or document requirements today?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelUsed: 'gemini-3.5-flash'
    }
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState(CHAT_ROLES[0]);
  const [selectedModel, setSelectedModel] = useState<'gemini-3.5-flash' | 'gemini-3.1-pro-preview' | 'gemini-3.1-flash-lite'>('gemini-3.5-flash');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInput('');
    setIsLoading(true);

    try {
      // Send entire history for multi-turn conversational context
      const payload = {
        messages: newHistory.map(m => ({
          role: m.role,
          text: m.text
        })),
        model: selectedModel,
        systemInstruction: selectedRole.instruction
      };

      const res = await secureWrite('/api/chat', 'POST', payload);

      const data = await res.json();

      if (data.success) {
        setMessages(prev => [
          ...prev,
          {
            id: `msg-${Date.now()}-ai`,
            role: 'assistant',
            text: data.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            modelUsed: data.modelUsed
          }
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: `msg-${Date.now()}-err`,
            role: 'assistant',
            text: `⚠️ **Notice:** ${data.error || 'Failed to generate response.'}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          text: `⚠️ **Connection Error:** ${err.message || 'Could not connect to Gemini service.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        text: `Chat reset. I am ready to assist you as the **${selectedRole.name}**. What would you like to know?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: selectedModel
      }
    ]);
  };

  // Helper to format basic markdown-style text (bold and bullets)
  const renderFormattedText = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Bold text replacement
      const formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return (
          <li
            key={idx}
            className="ml-4 list-disc text-slate-800"
            dangerouslySetInnerHTML={{ __html: formattedLine.replace(/^[-*]\s*/, '') }}
          />
        );
      }
      if (line.trim() === '') {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <p
          key={idx}
          className="leading-relaxed"
          dangerouslySetInnerHTML={{ __html: formattedLine }}
        />
      );
    });
  };

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-xl flex flex-col overflow-hidden ${
      isModal ? 'h-[85vh] max-w-2xl w-full' : 'h-[750px] max-w-4xl mx-auto'
    }`}>
      {/* Top Header */}
      <div className="bg-slate-900 text-white p-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base leading-tight">CampusFlow AI Chatbot</h3>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700">
                GEMINI
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Intelligent Multi-Turn Campus Concierge</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearChat}
            title="Clear Chat History"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-xs flex items-center gap-1 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Reset</span>
          </button>
          {isModal && onClose && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Role & Model Controls Toolbar */}
      <div className="bg-slate-50 border-b border-slate-200 p-3 px-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Role Selector */}
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-semibold">Assistant Persona:</span>
          <select
            value={selectedRole.id}
            onChange={e => {
              const r = CHAT_ROLES.find(item => item.id === e.target.value) || CHAT_ROLES[0];
              setSelectedRole(r);
            }}
            className="bg-white border border-slate-300 text-slate-800 rounded-lg px-2.5 py-1 text-xs font-semibold focus:ring-2 focus:ring-indigo-500 shadow-sm"
          >
            {CHAT_ROLES.map(r => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {/* Model Selector */}
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-semibold">Model:</span>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value as any)}
            className="bg-white border border-slate-300 text-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono font-medium focus:ring-2 focus:ring-indigo-500 shadow-sm"
          >
            <option value="gemini-3.5-flash">gemini-3.5-flash (General Tasks)</option>
            <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Fast Speed)</option>
            <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Complex Tasks)</option>
          </select>
        </div>
      </div>

      {/* Scrollable Message Thread */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40">
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm text-xs font-bold ${
                isUser ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-indigo-400'
              }`}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div className={`max-w-[85%] rounded-2xl p-4 text-xs space-y-1 shadow-sm ${
                isUser
                  ? 'bg-indigo-600 text-white rounded-tr-none'
                  : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
              }`}>
                <div className="space-y-1 text-xs">
                  {renderFormattedText(msg.text)}
                </div>

                <div className={`flex items-center justify-between text-[10px] pt-1.5 ${
                  isUser ? 'text-indigo-200' : 'text-slate-400'
                }`}>
                  <span>{msg.timestamp}</span>
                  {!isUser && msg.modelUsed && (
                    <span className="font-mono opacity-80">{msg.modelUsed}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-900 text-indigo-400 flex items-center justify-center shrink-0 shadow-sm">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 text-xs shadow-sm flex items-center gap-2 text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
              <span>CampusFlow AI is formulating guidance with {selectedModel}...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Starter Chips */}
      {messages.length <= 2 && (
        <div className="p-3 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto text-[11px]">
          <span className="text-slate-400 font-semibold whitespace-nowrap pl-1">Ask:</span>
          {PROMPT_SUGGESTIONS.map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(suggestion)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-full border border-slate-200 whitespace-nowrap transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Message Input Box */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form
          onSubmit={e => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask CampusFlow AI about queues, services, operating hours, documents..."
            className="flex-1 px-4 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow flex items-center gap-1.5"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
        <div className="text-[10px] text-slate-400 mt-1.5 flex items-center justify-between">
          <span>Active Persona: <strong>{selectedRole.name}</strong></span>
          <span>Google Gemini API</span>
        </div>
      </div>
    </div>
  );
};

