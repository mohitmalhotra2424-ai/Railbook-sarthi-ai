import type { Metadata } from "next";
import { SearchForm } from "@/components/SearchForm";

export const metadata: Metadata = { title: "Trains" };

export default function TrainsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold tracking-tight text-navy-900">
        Train search <span className="text-navy-400">· ट्रेन खोज</span>
      </h1>
      <p className="mt-0.5 mb-4 text-xs text-navy-600">
        Results come only from authorized data providers, with source and
        freshness on every answer.
      </p>
      <SearchForm />
    </div>
  );
}
