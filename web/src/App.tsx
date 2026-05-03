import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginScreen } from "./screens/LoginScreen";
import { ChatsScreen } from "./screens/ChatsScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { FeaturesScreen } from "./screens/FeaturesScreen";
import { TopicsScreen } from "./screens/TopicsScreen";
import { TopicEditScreen } from "./screens/TopicEditScreen";
import { UsersScreen } from "./screens/UsersScreen";
import { UserDetailScreen } from "./screens/UserDetailScreen";
import { WhitelistScreen } from "./screens/WhitelistScreen";
import { BannedWordsScreen } from "./screens/BannedWordsScreen";
import { LogsScreen } from "./screens/LogsScreen";
import { isAuthenticated } from "./lib/auth";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route
          path="/chats"
          element={
            <ProtectedRoute>
              <ChatsScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId"
          element={
            <ProtectedRoute>
              <DashboardScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/features"
          element={
            <ProtectedRoute>
              <FeaturesScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/topics"
          element={
            <ProtectedRoute>
              <TopicsScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/topics/:topicId"
          element={
            <ProtectedRoute>
              <TopicEditScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/users"
          element={
            <ProtectedRoute>
              <UsersScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/users/:userId"
          element={
            <ProtectedRoute>
              <UserDetailScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/whitelist"
          element={
            <ProtectedRoute>
              <WhitelistScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/banned-words"
          element={
            <ProtectedRoute>
              <BannedWordsScreen />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:chatId/logs"
          element={
            <ProtectedRoute>
              <LogsScreen />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={isAuthenticated() ? "/chats" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
