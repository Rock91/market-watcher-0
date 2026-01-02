/**
 * Rate limiter utility to prevent API rate limiting
 */

/**
 * Sleep for specified milliseconds
 */
export const sleep = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry a function with exponential backoff on rate limit errors
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            
            // Check if it's a rate limit error (429)
            const isRateLimit = error?.message?.includes('429') || 
                               error?.message?.includes('Too Many Requests') ||
                               error?.status === 429 ||
                               error?.statusCode === 429;
            
            if (isRateLimit && attempt < maxRetries - 1) {
                // Exponential backoff: 2s, 4s, 8s
                const delay = baseDelay * Math.pow(2, attempt);
                console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await sleep(delay);
                continue;
            }
            
            // If not rate limit or max retries reached, throw
            throw error;
        }
    }
    
    throw lastError;
}

