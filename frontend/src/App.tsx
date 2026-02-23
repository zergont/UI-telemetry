import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Header from "@/components/layout/Header";
import PageTransition from "@/components/layout/PageTransition";
import { ThemeProvider } from "@/hooks/use-theme";
import { useWebSocket } from "@/hooks/use-websocket";
import StartPage from "@/pages/StartPage";
import ObjectPage from "@/pages/ObjectPage";
import EquipmentPage from "@/pages/EquipmentPage";

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
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
