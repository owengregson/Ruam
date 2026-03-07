import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import CodeShowcase from "@/components/CodeShowcase";
import PipelineFlow from "@/components/PipelineFlow";
import GetStarted from "@/components/GetStarted";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <CodeShowcase />
        <PipelineFlow />
        <GetStarted />
      </main>
      <Footer />
    </>
  );
}
