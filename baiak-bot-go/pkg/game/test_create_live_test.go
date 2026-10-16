package game

import (
	"context"
	"testing"
)

func TestLiveCreateGold(t *testing.T) {
	token := "0d527aa90a9be64ae143443d2579b5e7e130b2bbb87e0c7d340223ae95e96b53"
	cli := NewTRPCClient(token, "https://baiakidle.com", "")
	ctx := context.Background()
	_ = cli
	_ = ctx

	bal, err := cli.Query(ctx, "coin.balances", nil)
	t.Logf("coin.balances: err=%v, res=%+v", err, bal)
}
