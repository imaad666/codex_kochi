import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

/** Smooth fitView whenever the graph structure changes. */
export default function GraphAutoFit({ signature = "" }) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const timer = setTimeout(() => {
      fitView({ padding: 0.34, duration: 480, minZoom: 0.22, maxZoom: 1.05 });
    }, 60);
    return () => clearTimeout(timer);
  }, [signature, fitView]);

  return null;
}
