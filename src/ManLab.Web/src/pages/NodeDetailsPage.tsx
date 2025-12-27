import { Navigate, useNavigate, useParams } from "react-router-dom";
import { NodeDetailView } from "@/components/NodeDetailView";

export function NodeDetailsPage() {
  const navigate = useNavigate();
  const { id } = useParams();

  if (!id) {
    return <Navigate to="/nodes" replace />;
  }

  return <NodeDetailView nodeId={id} onBack={() => navigate(-1)} />;
}
