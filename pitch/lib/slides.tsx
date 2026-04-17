"use client";

import { ReactNode } from "react";
import { PnlMethodologySlide } from "@/components/slides/PnlMethodologySlide";
import { TradingPnlSlide } from "@/components/slides/TradingPnlSlide";
import { PositionManagementSlide } from "@/components/slides/PositionManagementSlide";
import { IntellectualPropertySlide } from "@/components/slides/IntellectualPropertySlide";
import { DataSecuritySlide } from "@/components/slides/DataSecuritySlide";
import { CostRisksSlide } from "@/components/slides/CostRisksSlide";
import { BenefitsSlide } from "@/components/slides/BenefitsSlide";
import { ValuationPricingSlide } from "@/components/slides/ValuationPricingSlide";
import { TimelineSlide } from "@/components/slides/TimelineSlide";
import { IntroSlide } from "@/components/slides/IntroSlide";
import {
  Cpu,
  DollarSign,
  Waypoints,
  Lock,
  Shield,
  Scale,
  Trophy,
  Receipt,
  Calendar,
  Monitor,
} from "lucide-react";

export interface Slide {
  id: string;
  title: string;
  icon: ReactNode;
  content: ReactNode;
}

export const slides: Slide[] = [
  {
    id: "intro",
    title: "Posit",
    icon: <Monitor className="h-4 w-4" />,
    content: <IntroSlide />,
  },
  {
    id: "pnl-methodology",
    title: "Trading PnL Anatomy",
    icon: <Waypoints className="h-4 w-4" />,
    content: <PnlMethodologySlide />,
  },
  {
    id: "trading-pnl",
    title: "Problem & Solution",
    icon: <DollarSign className="h-4 w-4" />,
    content: <TradingPnlSlide />,
  },
  {
    id: "position-management",
    title: "Position Management",
    icon: <Cpu className="h-4 w-4" />,
    content: <PositionManagementSlide />,
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    icon: <Lock className="h-4 w-4" />,
    content: <IntellectualPropertySlide />,
  },
  {
    id: "data-security",
    title: "Data Security",
    icon: <Shield className="h-4 w-4" />,
    content: <DataSecuritySlide />,
  },
  {
    id: "cost-risks",
    title: "Cost & Risks",
    icon: <Scale className="h-4 w-4" />,
    content: <CostRisksSlide />,
  },
  {
    id: "benefits",
    title: "Benefits",
    icon: <Trophy className="h-4 w-4" />,
    content: <BenefitsSlide />,
  },
  {
    id: "valuation-pricing",
    title: "Valuation & Pricing",
    icon: <Receipt className="h-4 w-4" />,
    content: <ValuationPricingSlide />,
  },
  {
    id: "timeline",
    title: "Proposed Timeline",
    icon: <Calendar className="h-4 w-4" />,
    content: <TimelineSlide />,
  },
];
