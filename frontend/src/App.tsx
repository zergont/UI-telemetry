import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/layout/Header";
import PageTransition from "@/components/layout/PageTransition";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthContext, useAuthQuery } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import StartPage from "@/pages/StartPage";
import ObjectPage from "@/pages/ObjectPage";
import EquipmentPage from "@/pages/EquipmentPage";
import ShareLinksPage from "@/pages/ShareLinksPage";

function AppContent() {
  const location = useLocation();
  useWebSocket();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route
              path="/"
              element={
                <PageTransition>
                  <StartPage />
                </PageTransition>
              }
            />
            <Route
              path="/objects/:routerSn"
              element={
                <PageTransition>
                  <ObjectPage />
                </PageTransition>
              }
            />
            <Route
              path="/objects/:routerSn/equipment/:equipType/:panelId"
              element={
                <PageTransition>
                  <EquipmentPage />
                </PageTransition>
              }
            />
            <Route
              path="/admin/share-links"
              element={
                <PageTransition>
                  <ShareLinksPage />
                </PageTransition>
              }
            />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  const { data: auth } = useAuthQuery();

  // Пока /api/me не ответил — используем дефолт (admin для LAN)
  const authInfo = auth ?? {
    role: "admin" as const,
    method: "lan",
    scope_type: "all",
    scope_id: null,
  };

  return (
    <ThemeProvider>
      <AuthContext.Provider value={authInfo}>
        <AppContent />
      </AuthContext.Provider>
    </ThemeProvider>
  );
}
