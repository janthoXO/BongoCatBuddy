import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>BongoCatBuddy</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setGreetMsg(await invoke("greet", { name }));
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="Enter a name..."
            />
            <Button type="submit">Greet</Button>
          </form>
          <p className="text-sm text-muted-foreground">{greetMsg}</p>
        </CardContent>
      </Card>
    </main>
  );
}

export default App;
