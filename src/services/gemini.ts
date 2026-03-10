export const summarizeVideo = async (channelName: string, videoUrl: string) => {
  if (!videoUrl) {
    return { text: "請提供影片連結。", sources: [] };
  }

  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl, channelName }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to summarize video");
    }

    const data = await response.json();
    return {
      text: data.text,
      sources: [] // We don't have grounding sources anymore since we use transcript
    };
  } catch (error: any) {
    console.error("Error calling summarize API:", error);
    throw error;
  }
};
