/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { ConversationMirror } from "./components/ConversationMirror";
import { Debugger } from "./components/Debugger";

export default function App() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Slack Debugger</h1>
      <Debugger />
      <div className="mt-8">
        <ConversationMirror />
      </div>
    </div>
  );
}
