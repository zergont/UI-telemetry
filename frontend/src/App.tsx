import { lazy, Suspense } from "react";
import { matchPath, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { ShieldX } from "lucide-react";
import Header from "@/components/layout/Header";
import PageTransition from "@/components/layout/PageTransition";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthContext, useAuthQuery } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";

const StartPage = lazy(() => import("@/pages/StartPage"));
const ObjectPage = lazy(() => import("@/pages/ObjectPage"));
const EquipmentPage = lazy(() => import("@/pages/EquipmentPage"));
const ShareLinksPage = lazy(() => import("@/pages/ShareLinksPage"));
const SystemPage = lazy(() => import("@/pages/SystemPage"));

function AppContent() {
  const location = useLocation();
  const objectMatch = matchPath("/objects/:routerSn", location.pathname);
  const equipmentMatch = matchPath(
    "/objects/:routerSn/equipment/:equipType/:panelId",
    location.pathname,
  );
  const subscribe = equipmentMatch?.params.routerSn ?? objectMatch?.params.routerSn;

  useWebSocket(subscribe);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Header />
      <main className="container mx-auto px-4 py-6">
        <Suspense fallback={<div className="min-h-[60vh]" />}>
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
        </Suspense>
      </main>
      <span className="fixed bottom-1.5 right-2.5 text-[10px] text-muted-foreground/30 select-none pointer-events-none">
        v{__APP_VERSION__}
      </span>
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
