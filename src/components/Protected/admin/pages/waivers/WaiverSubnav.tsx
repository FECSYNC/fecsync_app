"use client";

import { useEffect, useState } from "react";
import WaiverSectionModal from "@/components/Protected/admin/pages/waivers/WaiverSectionModal";
import WaiverTabBar from "@/components/Protected/admin/pages/waivers/WaiverTabBar";

let hostClaimed = false;

export default function WaiverSubnav() {
  const [ownsModal, setOwnsModal] = useState(false);

  useEffect(() => {
    if (hostClaimed) return;
    hostClaimed = true;
    setOwnsModal(true);
    return () => {
      hostClaimed = false;
    };
  }, []);

  return (
    <>
      <WaiverTabBar />
      {ownsModal ? <WaiverSectionModal /> : null}
    </>
  );
}
