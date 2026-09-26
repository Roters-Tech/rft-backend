export async function sendExpoPushNotification(
  token: string | string[],
  title: string,
  body: string,
  data?: Record<string, any>
) {
  const tokenList = Array.isArray(token) ? token : [token];
  const validTokens = tokenList.filter(
    (t) => t && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))
  );

  if (validTokens.length === 0) {
    return;
  }

  // Chunk in batches of 100 as per Expo Push API specifications
  const chunks: string[][] = [];
  for (let i = 0; i < validTokens.length; i += 100) {
    chunks.push(validTokens.slice(i, i + 100));
  }

  const results: any[] = [];

  for (const chunk of chunks) {
    const messages = chunk.map((to) => ({
      to,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: 'default',
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });
      const result = await response.json();
      results.push(result);
    } catch (err) {
      console.warn('Failed to send Expo Push Notification batch:', err);
    }
  }

  return results;
}
