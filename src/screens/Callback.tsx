import { useAuthCallback } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';

export default function Callback() {
  const navigate = useNavigate();
  const { isLoading, error } = useAuthCallback(() => {
    navigate('/chats', { replace: true });
  });

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center">
        <p className="text-red-500 font-medium mb-2">Sign-in failed</p>
        <p className="text-sm text-[#2D3436]/50 dark:text-[#e2e8f0]/50">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-10 h-10 border-4 border-[#67B88B] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#2D3436]/50 dark:text-[#e2e8f0]/50 text-sm">Signing in…</p>
      </div>
    );
  }

  return null;
}
