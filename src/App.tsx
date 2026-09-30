/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext.js';
import { TrafficProvider } from './context/TrafficContext.js';
import { Navbar } from './components/Navbar.js';
import { SignInScreen } from './components/SignInScreen.js';
import { HiggsfieldCampusFlowHome } from './components/HiggsfieldCampusFlowHome.js';
import { SmartTraffic } from './components/SmartTraffic.js';
import { ServiceDetailModal } from './components/ServiceDetailModal.js';
import { JoinQueueModal } from './components/JoinQueueModal.js';
import { AppointmentModal } from './components/AppointmentModal.js';
import { MyActivity } from './components/MyActivity.js';
import { MyPass } from './components/MyPass.js';
import { PlanVisit } from './components/PlanVisit.js';
import { StorageNotice } from './components/StorageNotice.js';
import { CampusMap } from './components/CampusMap.js';
import { AdminAnalytics } from './components/AdminAnalytics.js';
import { StaffOperations } from './components/StaffOperations.js';
import { NotificationDrawer } from './components/NotificationDrawer.js';
import { OfflineBanner } from './components/OfflineBanner.js';
import { GeminiChatbot } from './components/GeminiChatbot.js';
import { VeoVideoAnimator } from './components/VeoVideoAnimator.js';
import { Service } from './types/index.js';
import { Bot, X, ShieldAlert } from 'lucide-react';

const MainAppContent: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    services,
    joinQueue,
    myQueues,
    currentUser,
    authStatus,
    authError,
    signIn,
    isLoading,
    refreshData
  } = useApp();

  const [serviceForModal, setServiceForModal] = useState<Service | null>(null);
  const [serviceToJoin, setServiceToJoin] = useState<Service | null>(null);
  const [serviceToBook, setServiceToBook] = useState<Service | null>(null);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState<boolean>(false);
  const [isFloatingChatOpen, setIsFloatingChatOpen] = useState<boolean>(false);

  // Boot screen while the session cookie is being resolved.
  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#121315] text-[#f2efe7] flex items-center justify-center">
        <div className="text-center">
          <span className="brand-mark inline-flex">↗</span>
          <p className="mt-4 text-sm text-slate-400">Loading CampusFlow…</p>
        </div>
      </div>
    );
  }

  // Unauthenticated visitors get the sign-in screen and nothing else.
  if (authStatus === 'anonymous' || !currentUser) {
    return <SignInScreen signIn={signIn} sessionError={authError} />;
  }

  const role = currentUser.role;
  const canOperate = role === 'staff' || role === 'admin';
  const canAudit = role === 'staff' || role === 'admin';
  const hitRestrictedTab =
    (activeTab === 'analytics' && !canAudit) || (activeTab === 'staff' && !canOperate);

  return (
    <div className="campus-shell min-h-screen flex flex-col text-[#f2efe7] bg-[#121315] antialiased selection:bg-[#d9f65b] selection:text-[#121315] relative">
      {/* Connectivity state, always visible when it changes. */}
      <OfflineBanner onSynced={() => refreshData()} />

      {/* Top Navigation conforming to Higgsfield CampusFlow */}
      <Navbar onOpenNotifications={() => setIsNotifDrawerOpen(true)} />

      {/* Main Content Area */}
      <main className="flex-1 w-full">
        <StorageNotice />

        {isLoading && services.length === 0 && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-center text-sm text-slate-400">
            Loading campus services…
          </div>
        )}

        {activeTab === 'services' && (
          <HiggsfieldCampusFlowHome
            onSelectService={srv => setServiceForModal(srv)}
            onJoinQueue={srv => setServiceToJoin(srv)}
            onBookAppointment={srv => setServiceToBook(srv)}
            onOpenActivity={() => setActiveTab('activity')}
          />
        )}

        {activeTab === 'plan' && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <PlanVisit onOpenService={serviceId => {
              const target = services.find(s => s.id === serviceId);
              if (target) setServiceForModal(target);
            }} />
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
            <MyPass onOpenService={serviceId => {
              const target = services.find(s => s.id === serviceId);
              if (target) setServiceForModal(target);
            }} />
            <MyActivity />
          </div>
        )}

        {activeTab === 'map' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <CampusMap
              onSelectService={srv => setServiceForModal(srv)}
              onJoinQueue={srv => setServiceToJoin(srv)}
            />
          </div>
        )}

        {activeTab === 'traffic' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <SmartTraffic
              onSelectService={srv => setServiceForModal(srv)}
              onJoinQueue={srv => setServiceToJoin(srv)}
            />
          </div>
        )}

        {activeTab === 'analytics' && canAudit && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <AdminAnalytics />
          </div>
        )}

        {activeTab === 'staff' && canOperate && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
            <StaffOperations />
          </div>
        )}

        {/* A student who reaches a restricted tab is told why, not left on a blank page. */}
        {hitRestrictedTab && (
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-20 text-center">
            <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-white mb-2">Staff access required</h2>
            <p className="text-sm text-slate-400">
              This area is restricted to counter staff and administrators. Your account is signed in as a
              student, which cannot run counters or view campus-wide analytics.
            </p>
            <button
              onClick={() => setActiveTab('services')}
              className="mt-6 px-4 py-2.5 rounded-xl bg-[#d9f65b] text-[#121315] text-sm font-black hover:bg-[#e4fa78] transition"
            >
              Back to services
            </button>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <GeminiChatbot />
          </div>
        )}

        {activeTab === 'veo' && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <VeoVideoAnimator />
          </div>
        )}
      </main>

      {/* Floating Gemini AI Chatbot Trigger */}
      {activeTab !== 'chat' && (
        <button
          onClick={() => setIsFloatingChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-[#d9f65b] hover:bg-[#e4fa78] text-[#121315] font-black text-xs px-4 py-3 rounded-full shadow-[0_10px_30px_rgba(217,246,91,0.35)] flex items-center gap-2 border border-white/20 transition-all hover:scale-105 active:scale-95"
          aria-label="Open AI Assistant"
        >
          <Bot className="w-4 h-4 text-[#121315]" />
          <span>Ask Campus AI</span>
        </button>
      )}

      {/* Floating Gemini Chat Modal */}
      {isFloatingChatOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#18191d] text-[#f2efe7] w-full sm:max-w-2xl h-[85vh] rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl flex flex-col overflow-hidden animate-slideUp">
            <div className="p-4 bg-[#121315] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#d9f65b] animate-pulse" />
                <span className="font-bold text-sm text-white">CampusFlow AI Assistant</span>
              </div>
              <button
                onClick={() => setIsFloatingChatOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <GeminiChatbot />
            </div>
          </div>
        </div>
      )}

      {/* Service Detail Modal */}
      {serviceForModal && (
        <ServiceDetailModal
          service={serviceForModal}
          onClose={() => setServiceForModal(null)}
          isInQueue={myQueues.some(entry => entry.service_id === serviceForModal.id && entry.status === 'waiting')}
          onSwitchService={serviceId => {
            const next = services.find(s => s.id === serviceId) ?? null;
            if (next) setServiceForModal(next);
          }}
          onJoinQueue={srv => {
            setServiceForModal(null);
            setServiceToJoin(srv);
          }}
          onBookAppointment={srv => {
            setServiceForModal(null);
            setServiceToBook(srv);
          }}
        />
      )}

      {/* Join Queue Modal */}
      {serviceToJoin && (
        <JoinQueueModal
          service={serviceToJoin}
          onClose={() => setServiceToJoin(null)}
          onConfirm={async (serviceId, checkInType) => {
            const result = await joinQueue(serviceId, checkInType);
            if (result.success) {
              setServiceToJoin(null);
              setActiveTab('activity');
            }
            return result;
          }}
        />
      )}

      {/* Book Appointment Modal */}
      {serviceToBook && (
        <AppointmentModal service={serviceToBook} onClose={() => setServiceToBook(null)} />
      )}

      {/* Notifications Drawer */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AppProvider>
      <TrafficBridge />
    </AppProvider>
  );
};

/** Keeps the traffic provider bound to the signed-in account. */
const TrafficBridge: React.FC = () => {
  const { currentUser } = useApp();
  return (
    <TrafficProvider userId={currentUser?.id ?? null}>
      <MainAppContent />
    </TrafficProvider>
  );
};

export default App;
