import type { Integration } from '@/types';
import {
  Users,
  Cloud,
  Target,
  TrendingUp,
  Mail,
  Inbox,
  MessageSquare,
  MessageCircle,
  Calendar,
  CalendarDays,
  Clock,
  CheckSquare,
  ListTodo,
  SquareDot,
  FileText,
  Folder,
  HardDrive,
  PenTool,
  BookOpen,
  Calculator,
  Landmark,
  CreditCard,
  IndianRupee,
  BadgeCheck,
  Briefcase,
  LifeBuoy,
  Headset,
  Ticket,
  Send,
  BarChart3,
  Megaphone,
  ShoppingBag,
  Package,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Users,
  Cloud,
  Target,
  TrendingUp,
  Mail,
  Inbox,
  MessageSquare,
  MessageCircle,
  Calendar,
  CalendarDays,
  Clock,
  CheckSquare,
  ListTodo,
  SquareDot,
  FileText,
  Folder,
  HardDrive,
  PenTool,
  BookOpen,
  Calculator,
  Landmark,
  CreditCard,
  IndianRupee,
  BadgeCheck,
  Briefcase,
  LifeBuoy,
  Headset,
  Ticket,
  Send,
  BarChart3,
  Megaphone,
  ShoppingBag,
  Package,
};

interface AppIconProps {
  integration: Integration;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: { container: 'w-10 h-10 rounded-lg', icon: 18, text: 'text-xs' },
  md: { container: 'w-12 h-12 rounded-xl', icon: 22, text: 'text-sm' },
  lg: { container: 'w-16 h-16 rounded-2xl', icon: 30, text: 'text-lg' },
};

export function AppIcon({ integration, size = 'md' }: AppIconProps) {
  const dims = SIZE_MAP[size];
  const Icon = ICON_MAP[integration.icon] ?? Cloud;

  return (
    <div
      className={`${dims.container} flex items-center justify-center shrink-0 relative overflow-hidden`}
      style={{ backgroundColor: integration.color }}
    >
      <Icon
        size={dims.icon}
        className="text-white relative z-10"
        strokeWidth={2}
      />
      <div className="absolute inset-0 bg-white/10" />
    </div>
  );
}
