/** Runs category prompts serially so inbox evaluation can return promptly.
 * Example: `queue.add(() => classifyEmail())`.
 */
export class CategoryEvaluationQueue {
  private tail: Promise<void> = Promise.resolve();

  add(job: () => Promise<void>): void {
    this.tail = this.tail.then(job, job);
  }
}
