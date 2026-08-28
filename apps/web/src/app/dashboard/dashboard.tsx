"use client";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

const Dashboard = () => {
  const privateData = useQuery(trpc.privateData.queryOptions());

  return <p>API: {privateData.data?.message}</p>;
};

export default Dashboard;
