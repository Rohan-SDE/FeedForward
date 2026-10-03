import { createFileRoute } from "@tanstack/react-router";
import SupportPanel from "@/components/SupportPanel";
export const Route = createFileRoute("/_authenticated/support")({ component: SupportPanel });
