import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Footer } from "@/components/footer";

export default function Page() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Features />
      </main>
      <Footer />
    </>
  );
}
