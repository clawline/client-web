import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props { onLogin: (token: string) => void }

export function LoginScreen({ onLogin }: Props) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) onLogin(value.trim()); };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Relay Gateway</CardTitle>
          <p className="text-sm text-muted-foreground">输入管理令牌以继续</p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <input type="text" autoComplete="username" className="hidden" value="relay-admin" readOnly />
            <div className="grid gap-2">
              <Label>Admin Token</Label>
              <Input type="password" autoComplete="new-password" value={value} onChange={e => setValue(e.target.value)} placeholder="••••••••" />
            </div>
            <Button type="submit" className="w-full">登录</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
