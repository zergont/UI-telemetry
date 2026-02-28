import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ShieldX } from "lucide-react";
import Header from "@/components/layout/Header";
import PageTransition from "@/components/layout/PageTransition";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthContext, useAuthQuery } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import StartPage from "@/pages/StartPage";
import ObjectPage from "@/pages/ObjectPage";
import EquipmentPage from "@/pages/EquipmentPage";
import ShareLinksPage from "@/pages/ShareLinksPage";
import SystemPage from "@/pages/SystemPage";

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
            <Route
              path="/admin/system"
              element={
                <PageTransition>
                  <SystemPage />
                </PageTransition>
              }
            />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md px-6">
        <ShieldX className="h-16 w-16 text-red-500 mx-auto" />
        <h1 className="text-2xl font-bold">Доступ запрещён</h1>
        <p className="text-muted-foreground">
          Ссылка недействительна, отозвана или просрочена.
          Обратитесь к администратору для получения новой ссылки.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { data: auth, isError, isLoading } = useAuthQuery();

  // Пока /api/me не ответил — показываем пустой экран (не дефолтим на admin!)
  if (isLoading) {
    return (
      <ThemeProvider>
        <div className="min-h-screen bg-background" />
      </ThemeProvider>
    );
  }

  // /api/me вернул ошибку (401/403) — доступ запрещён
  if (isError) {
    return (
      <ThemeProvider>
        <AccessDenied />
      </ThemeProvider>
    );
  }

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
