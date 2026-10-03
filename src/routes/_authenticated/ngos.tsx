import { createFileRoute } from "@tanstack/react-router";
import NearbyNgos from "@/components/NearbyNgos";
export const Route = createFileRoute("/_authenticated/ngos")({ component: NearbyNgos });
